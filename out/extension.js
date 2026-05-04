"use strict";
// Human Study Chat Assistant - VS Code chat interface with AI assistance and code diff application
// Integrates with OpenRouter API for streaming chat responses
// Modified for automated human trial platform — fetches prompts from backend, logs all messages
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const patchApplier_1 = require("./patchApplier");
const TaskPanelProvider_1 = require("./TaskPanelProvider");
let chatPanel;
let conversationHistory = [];
let selectedFiles = [];
let cachedTrialConfig = null;
let studyStartPromise;
let instructionsOpened = false;
let chatState = 'idle';
let pendingToolCalls = new Map();
function hasPendingToolCalls() {
    for (const call of pendingToolCalls.values()) {
        if (call.status === 'pending') {
            return true;
        }
    }
    return false;
}
function setChatState(state, panel) {
    chatState = state;
    const isIdle = state === 'idle' && !hasPendingToolCalls();
    const target = panel || chatPanel;
    target?.webview.postMessage({
        command: 'setInputEnabled',
        enabled: isIdle,
        reason: isIdle ? '' : 'Resolve the current assistant response before continuing.',
    });
}
function resetPendingToolCalls(panel) {
    pendingToolCalls.clear();
    setChatState('idle', panel);
}
function resolvePendingToolCall(toolCallId, status, panel) {
    const pending = pendingToolCalls.get(toolCallId);
    if (pending) {
        pending.status = status;
    }
    if (!hasPendingToolCalls()) {
        setChatState('idle', panel);
    }
    else {
        setChatState('awaitingTool', panel);
    }
}
function appendToolResult(toolCallId, result) {
    conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify(result),
    });
}
/**
 * Read a JSON metadata file from the workspace root.
 */
function readWorkspaceJson(fileName) {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }
        const configPath = path.join(workspaceFolders[0].uri.fsPath, fileName);
        if (!fs.existsSync(configPath)) {
            return null;
        }
        const data = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
/**
 * Read the trial config file written by the backend after the study starts.
 */
function readTrialConfig() {
    const config = readWorkspaceJson('.trial_config.json');
    if (config) {
        cachedTrialConfig = config;
    }
    return config;
}
/**
 * Read the pre-study registration metadata written before task files exist.
 */
function readTrialRegistration() {
    return readWorkspaceJson('.trial_registration.json');
}
/**
 * Get the backend URL from VS Code settings.
 */
function getBackendUrl() {
    const config = vscode.workspace.getConfiguration('simple-chat');
    return config.get('backendUrl') || 'https://code.johnheibel.com';
}
async function ensureStudyStarted() {
    if (readTrialConfig()?.participant_id) {
        return;
    }
    const registration = readTrialRegistration();
    if (!registration?.participant_id) {
        return;
    }
    if (studyStartPromise) {
        return studyStartPromise;
    }
    studyStartPromise = (async () => {
        if (readTrialConfig()?.participant_id) {
            return;
        }
        const backendUrl = registration.backend_url || getBackendUrl();
        try {
            await axios_1.default.post(`${backendUrl}/api/study/start/${registration.participant_id}`);
            readTrialConfig();
        }
        catch (error) {
            const detail = error.response?.data?.detail || error.message || 'unknown error';
            vscode.window.showErrorMessage(`Failed to start study: ${detail}`);
        }
        finally {
            studyStartPromise = undefined;
        }
    })();
    return studyStartPromise;
}
async function openInstructionsReadme() {
    if (instructionsOpened) {
        return;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }
    const readmePath = path.join(workspaceFolders[0].uri.fsPath, 'README.md');
    if (!fs.existsSync(readmePath)) {
        return;
    }
    instructionsOpened = true;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(readmePath));
    await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
    });
}
/**
 * Log a chat message to the backend (fire-and-forget).
 */
async function logChatMessage(participantId, role, content, toolCallData) {
    const backendUrl = getBackendUrl();
    await axios_1.default.post(`${backendUrl}/api/log/chat-message/${participantId}`, {
        role,
        content,
        tool_call_data: toolCallData ? JSON.stringify(toolCallData) : null,
    }).catch(() => { }); // fire-and-forget
}
/**
 * Log an event to the backend (fire-and-forget).
 */
async function logEvent(participantId, eventType, eventData) {
    const backendUrl = getBackendUrl();
    await axios_1.default.post(`${backendUrl}/api/log/event/${participantId}`, {
        event_type: eventType,
        event_data: eventData ? JSON.stringify(eventData) : null,
    }).catch(() => { });
}
/**
 * Returns the system prompt for the AI assistant.
 * Fetches from the trial backend based on participant's current (condition, scenario).
 */
async function return_system_prompt() {
    try {
        const trialConfig = readTrialConfig();
        if (!trialConfig?.participant_id) {
            return 'You are a helpful coding assistant.';
        }
        const backendUrl = getBackendUrl();
        const response = await axios_1.default.get(`${backendUrl}/api/prompts/${trialConfig.participant_id}`);
        return response.data.prompt;
    }
    catch (error) {
        console.error('Failed to fetch prompt from backend:', error);
        return 'You are a helpful coding assistant.';
    }
}
class ChatViewProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            const item = new vscode.TreeItem('New Assistant Chat', vscode.TreeItemCollapsibleState.None);
            item.command = {
                command: 'simpleChat.openChat',
                title: 'Open Human Study Chat Assistant'
            };
            return Promise.resolve([item]);
        }
        return Promise.resolve([]);
    }
}
function activate(context) {
    // Register tree view provider
    const chatViewProvider = new ChatViewProvider();
    vscode.window.registerTreeDataProvider('simpleChatView', chatViewProvider);
    // Register task panel provider
    const taskPanelProvider = new TaskPanelProvider_1.TaskPanelProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(TaskPanelProvider_1.TaskPanelProvider.viewType, taskPanelProvider));
    // When task changes, clear chat history
    taskPanelProvider.onTaskChanged(() => {
        conversationHistory = [];
        pendingToolCalls.clear();
        chatState = 'idle';
        if (chatPanel) {
            chatPanel.webview.postMessage({ command: 'clearChat' });
            setChatState('idle', chatPanel);
        }
    });
    // Register configure command
    const configureCommand = vscode.commands.registerCommand('simpleChat.configure', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your OpenRouter API key',
            ignoreFocusOut: true,
            password: true,
        });
        if (!apiKey) {
            return;
        }
        const model = await vscode.window.showInputBox({
            prompt: 'Enter model name (e.g., anthropic/claude-sonnet-4.5)',
            ignoreFocusOut: true,
            value: 'anthropic/claude-sonnet-4.5',
        });
        if (!model) {
            return;
        }
        await context.globalState.update('config', {
            apiKey,
            model,
            baseUrl: 'https://openrouter.ai/api/v1',
        });
        vscode.window.showInformationMessage('OpenRouter configured!');
    });
    // Register select files command
    const selectFilesCommand = vscode.commands.registerCommand('simpleChat.selectFiles', async () => {
        const files = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Add to Chat Context',
            filters: {
                'All Files': ['*'],
            },
        });
        if (files && files.length > 0) {
            selectedFiles = files.map(f => f.fsPath);
            vscode.window.showInformationMessage(`Added ${files.length} file(s) to chat context`);
            // Update chat panel if open
            if (chatPanel) {
                chatPanel.webview.postMessage({
                    command: 'updateFileList',
                    files: selectedFiles,
                });
            }
        }
    });
    // Register clear files command
    const clearFilesCommand = vscode.commands.registerCommand('simpleChat.clearFiles', () => {
        selectedFiles = [];
        vscode.window.showInformationMessage('Cleared file context');
        if (chatPanel) {
            chatPanel.webview.postMessage({
                command: 'updateFileList',
                files: [],
            });
        }
    });
    // Register open chat command
    const openChatCommand = vscode.commands.registerCommand('simpleChat.openChat', async () => {
        if (chatPanel) {
            chatPanel.reveal();
            await ensureStudyStarted();
            return;
        }
        chatPanel = vscode.window.createWebviewPanel('simpleChat', 'Human Study Chat Assistant', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'node_modules'),
            ],
        });
        chatPanel.webview.html = getWebviewContent(chatPanel.webview, context.extensionUri);
        // Send initial file list
        chatPanel.webview.postMessage({
            command: 'updateFileList',
            files: selectedFiles,
        });
        chatPanel.webview.onDidReceiveMessage(async (message) => {
            console.log('Received message from webview:', message);
            switch (message.command) {
                case 'sendMessage':
                    console.log('Handling sendMessage:', message.text);
                    await handleSendMessage(message.text, context, chatPanel);
                    break;
                case 'clearHistory':
                    conversationHistory = [];
                    resetPendingToolCalls(chatPanel);
                    chatPanel?.webview.postMessage({ command: 'clearChat' });
                    break;
                case 'selectFiles':
                    // Get list of open text documents
                    const openFiles = vscode.workspace.textDocuments
                        .filter(doc => doc.uri.scheme === 'file')
                        .map(doc => ({
                        path: doc.uri.fsPath,
                        name: doc.uri.fsPath.split('/').pop() || doc.uri.fsPath,
                    }));
                    if (openFiles.length === 0) {
                        vscode.window.showInformationMessage('No files are currently open');
                        break;
                    }
                    // Show quick pick to select files
                    const selected = await vscode.window.showQuickPick(openFiles.map(f => f.path), {
                        canPickMany: true,
                        placeHolder: 'Select files to add to chat context',
                    });
                    if (selected && selected.length > 0) {
                        selectedFiles = selected;
                        chatPanel?.webview.postMessage({
                            command: 'updateFileList',
                            files: selectedFiles,
                        });
                    }
                    break;
                case 'clearFiles':
                    selectedFiles = [];
                    chatPanel?.webview.postMessage({
                        command: 'updateFileList',
                        files: [],
                    });
                    break;
                case 'approveToolCall':
                    await handleApproveToolCall(message.toolCallId, message.toolName, message.args, context, chatPanel);
                    break;
                case 'rejectToolCall':
                    await handleRejectToolCall(message.toolCallId, chatPanel);
                    break;
            }
        }, undefined, context.subscriptions);
        chatPanel.onDidDispose(() => {
            chatPanel = undefined;
        });
        await ensureStudyStarted();
    });
    context.subscriptions.push(configureCommand, selectFilesCommand, clearFilesCommand, openChatCommand);
    void (async () => {
        await openInstructionsReadme();
        await vscode.commands.executeCommand('simpleChat.openChat');
    })();
}
async function handleSendMessage(userMessage, context, panel) {
    try {
        if (chatState !== 'idle' || hasPendingToolCalls()) {
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'system',
                content: 'Please approve or reject the pending edit before sending another message.',
            });
            return;
        }
        setChatState('streaming', panel);
        let config = context.globalState.get('config');
        // Use settings-based defaults if not configured via command
        if (!config) {
            const settings = vscode.workspace.getConfiguration('simple-chat');
            config = {
                apiKey: settings.get('apiKey') || '',
                model: settings.get('model') || 'anthropic/claude-sonnet-4.5',
                baseUrl: settings.get('baseUrl') || 'https://openrouter.ai/api/v1',
            };
        }
        if (!config.apiKey) {
            setChatState('idle', panel);
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'error',
                content: 'No API key configured. Please configure via settings or the Configure command.',
            });
            return;
        }
        // Build context from selected files
        let contextMessage = userMessage;
        if (selectedFiles.length > 0) {
            const fileContents = await Promise.all(selectedFiles.map(async (filePath) => {
                try {
                    const uri = vscode.Uri.file(filePath);
                    const content = await vscode.workspace.fs.readFile(uri);
                    const text = Buffer.from(content).toString('utf8');
                    return `\n\n--- File: ${filePath} ---\n${text}`;
                }
                catch (error) {
                    return `\n\n--- File: ${filePath} ---\n[Error reading file]`;
                }
            }));
            contextMessage = `${userMessage}\n\nContext files:${fileContents.join('')}`;
        }
        conversationHistory.push({
            role: 'user',
            content: contextMessage,
        });
        // Log user message to backend
        const trialConfig = readTrialConfig();
        if (trialConfig?.participant_id) {
            logChatMessage(trialConfig.participant_id, 'user', contextMessage);
        }
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'user',
            content: userMessage,
        });
        panel.webview.postMessage({ command: 'startStreaming' });
        // Get system prompt and build messages array
        const systemPrompt = await return_system_prompt();
        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory
        ];
        // Define tools for the model
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'edit_file',
                    description: 'Edit a file by providing a unified diff format patch. The diff will be shown to the user for approval before being applied.',
                    parameters: {
                        type: 'object',
                        properties: {
                            file_path: {
                                type: 'string',
                                description: 'The full absolute path to the file to edit (e.g., /Users/name/project/file.py)'
                            },
                            diff: {
                                type: 'string',
                                description: 'A unified diff format patch showing the changes. Format: "--- /absolute/path\\n+++ /absolute/path\\n@@ -start,count +start,count @@\\n context\\n-removed\\n+added". Include context lines (prefixed with space) around changes for reliable matching.'
                            },
                            description: {
                                type: 'string',
                                description: 'A brief description of what changes this diff makes'
                            }
                        },
                        required: ['file_path', 'diff', 'description']
                    }
                }
            }
        ];
        const response = await axios_1.default.post(`${config.baseUrl}/chat/completions`, {
            model: config.model,
            messages: messages,
            tools: tools,
            stream: true,
        }, {
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            responseType: 'stream',
        });
        let assistantMessage = '';
        let toolCalls = [];
        let sseBuffer = '';
        const processSseLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) {
                return;
            }
            if (!trimmed.startsWith('data: ')) {
                return;
            }
            const payload = trimmed.slice(6).trim();
            if (payload === '[DONE]') {
                return;
            }
            try {
                const data = JSON.parse(payload);
                const delta = data.choices[0]?.delta;
                // Handle regular content
                if (delta?.content) {
                    assistantMessage += delta.content;
                    panel.webview.postMessage({
                        command: 'streamChunk',
                        content: delta.content,
                    });
                }
                // Handle tool calls
                if (delta?.tool_calls) {
                    for (const toolCallDelta of delta.tool_calls) {
                        if (toolCallDelta.index !== undefined) {
                            if (!toolCalls[toolCallDelta.index]) {
                                toolCalls[toolCallDelta.index] = {
                                    id: toolCallDelta.id || '',
                                    type: toolCallDelta.type || 'function',
                                    function: {
                                        name: toolCallDelta.function?.name || '',
                                        arguments: toolCallDelta.function?.arguments || ''
                                    }
                                };
                            }
                            else {
                                // Append to existing tool call
                                if (toolCallDelta.id) {
                                    toolCalls[toolCallDelta.index].id = toolCallDelta.id;
                                }
                                if (toolCallDelta.type) {
                                    toolCalls[toolCallDelta.index].type = toolCallDelta.type;
                                }
                                if (toolCallDelta.function?.name) {
                                    toolCalls[toolCallDelta.index].function.name += toolCallDelta.function.name;
                                }
                                if (toolCallDelta.function?.arguments) {
                                    toolCalls[toolCallDelta.index].function.arguments += toolCallDelta.function.arguments;
                                }
                            }
                        }
                    }
                }
            }
            catch (e) {
                console.error('Failed to parse SSE payload:', e, payload);
            }
        };
        response.data.on('data', (chunk) => {
            sseBuffer += chunk.toString();
            const lines = sseBuffer.split(/\r?\n/);
            sseBuffer = lines.pop() || '';
            for (const line of lines) {
                processSseLine(line);
            }
        });
        await new Promise((resolve, reject) => {
            response.data.on('end', () => {
                if (sseBuffer.trim()) {
                    processSseLine(sseBuffer);
                    sseBuffer = '';
                }
                console.log('Stream ended. Tool calls count:', toolCalls.length);
                console.log('Tool calls:', JSON.stringify(toolCalls, null, 2));
                // Build the assistant message for conversation history
                const assistantHistoryMessage = {
                    role: 'assistant',
                    content: assistantMessage || null,
                };
                const completedToolCalls = toolCalls.filter(Boolean);
                for (const toolCall of completedToolCalls) {
                    if (!toolCall.id) {
                        toolCall.id = `tool_${Date.now()}_${Math.random().toString(16).slice(2)}`;
                    }
                }
                if (completedToolCalls.length > 0) {
                    assistantHistoryMessage.tool_calls = completedToolCalls;
                }
                conversationHistory.push(assistantHistoryMessage);
                // Log assistant message to backend
                const tc = readTrialConfig();
                if (tc?.participant_id) {
                    logChatMessage(tc.participant_id, 'assistant', assistantMessage || '', completedToolCalls.length > 0 ? completedToolCalls : undefined);
                }
                panel.webview.postMessage({ command: 'endStreaming' });
                // If there are tool calls, show them for approval
                if (completedToolCalls.length > 0) {
                    setChatState('awaitingTool', panel);
                    // Show visual indicator that tool calls are being prepared
                    panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'system',
                        content: completedToolCalls.length === 1
                            ? 'Preparing proposed edit...'
                            : `Preparing ${completedToolCalls.length} proposed edits...`,
                    });
                    for (const toolCall of completedToolCalls) {
                        const toolCallId = toolCall.id;
                        try {
                            console.log('Parsing tool call arguments:', toolCall.function.arguments);
                            if (toolCall.function.name !== 'edit_file') {
                                appendToolResult(toolCallId, {
                                    success: false,
                                    message: `Unsupported tool: ${toolCall.function.name}`,
                                });
                                panel.webview.postMessage({
                                    command: 'addMessage',
                                    role: 'error',
                                    content: `Unsupported tool requested: ${toolCall.function.name}`,
                                });
                                continue;
                            }
                            // Try to repair common JSON issues
                            let argsString = toolCall.function.arguments;
                            // Fix missing colon and quote after keys: "key value" => "key":"value"
                            // This handles cases like "diff--- => "diff":"---
                            argsString = argsString.replace(/"(\w+)"(?!:)(\S)/g, '"$1":"$2');
                            console.log('Repaired arguments:', argsString);
                            const args = JSON.parse(argsString);
                            pendingToolCalls.set(toolCallId, {
                                id: toolCallId,
                                name: toolCall.function.name,
                                args,
                                status: 'pending',
                            });
                            panel.webview.postMessage({
                                command: 'showToolCall',
                                toolCallId,
                                toolName: toolCall.function.name,
                                args: args,
                            });
                        }
                        catch (parseError) {
                            console.error('Failed to parse tool call arguments:', parseError.message);
                            console.error('Arguments string:', toolCall.function.arguments);
                            appendToolResult(toolCallId, {
                                success: false,
                                message: `Failed to parse edit arguments: ${parseError.message}`,
                            });
                            panel.webview.postMessage({
                                command: 'addMessage',
                                role: 'error',
                                content: `Failed to parse tool call: ${parseError.message}`,
                            });
                        }
                    }
                    if (!hasPendingToolCalls()) {
                        setChatState('idle', panel);
                    }
                }
                else {
                    setChatState('idle', panel);
                }
                resolve();
            });
            response.data.on('error', (err) => {
                reject(err);
            });
        });
    }
    catch (error) {
        panel.webview.postMessage({ command: 'hideTyping' });
        setChatState('idle', panel);
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'error',
            content: `Error: ${error.message}`,
        });
    }
}
function extractDiffPath(diffContent) {
    const lines = diffContent.split('\n');
    let filePath = '';
    for (const line of lines) {
        if (line.startsWith('--- ')) {
            filePath = line.substring(4).trim().replace(/^a\//, '').replace(/^b\//, '');
            break;
        }
    }
    if (!filePath) {
        throw new Error('Could not determine file path from diff');
    }
    if (filePath === '/dev/null') {
        throw new Error('Creating new files is not supported by this editor');
    }
    return filePath;
}
function resolveWorkspaceFile(inputPath) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder open');
    }
    const workspaceRoot = path.resolve(workspaceFolder.uri.fsPath);
    let candidate = inputPath.trim().replace(/^a\//, '').replace(/^b\//, '');
    // Normalize path
    // Handle missing leading slash (e.g., "Users/..." should be "/Users/...")
    if (!candidate.startsWith('/') && !candidate.startsWith('.') &&
        (candidate.startsWith('Users/') || candidate.startsWith('home/') ||
            candidate.includes(':/') || /^[A-Za-z]:[\\/]/.test(candidate))) {
        candidate = '/' + candidate;
    }
    // Determine if path is absolute
    const isAbsolute = candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate);
    const resolvedPath = path.resolve(isAbsolute ? candidate : path.join(workspaceRoot, candidate));
    const relativePath = path.relative(workspaceRoot, resolvedPath);
    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Refusing to edit a file outside the workspace: ${inputPath}`);
    }
    return {
        uri: vscode.Uri.file(resolvedPath),
        fsPath: resolvedPath,
        relativePath,
    };
}
async function handleApplyDiff(args) {
    const diffContent = String(args?.diff || '');
    const requestedPath = String(args?.file_path || '');
    const diffPath = extractDiffPath(diffContent);
    const target = resolveWorkspaceFile(diffPath);
    if (requestedPath) {
        const requested = resolveWorkspaceFile(requestedPath);
        if (requested.fsPath !== target.fsPath) {
            throw new Error(`Diff target (${target.relativePath}) does not match requested file (${requested.relativePath})`);
        }
    }
    // Read original content
    let originalContent;
    try {
        const content = await vscode.workspace.fs.readFile(target.uri);
        originalContent = Buffer.from(content).toString('utf8');
    }
    catch (error) {
        throw new Error(`Failed to read file ${target.relativePath}: ${error.message}`);
    }
    // Apply patch using the reliable patch applier
    const result = (0, patchApplier_1.applyPatch)(originalContent, diffContent);
    if (!result.success) {
        throw new Error(result.error || 'Failed to apply patch');
    }
    // Write new content
    try {
        await vscode.workspace.fs.writeFile(target.uri, Buffer.from(result.newContent, 'utf8'));
        vscode.window.showInformationMessage(`Applied changes to ${target.relativePath}`);
        return target.relativePath;
    }
    catch (error) {
        throw new Error(`Failed to write file ${target.relativePath}: ${error.message}`);
    }
}
async function handleApproveToolCall(toolCallId, toolName, args, context, panel) {
    const pending = pendingToolCalls.get(toolCallId);
    if (!pending || pending.status !== 'pending') {
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'system',
            content: 'That edit has already been resolved.',
        });
        return;
    }
    try {
        setChatState('applyingTool', panel);
        if (toolName === 'edit_file') {
            // Apply the diff
            const editedFile = await handleApplyDiff(args);
            // Add tool response to conversation history with tool_call_id
            appendToolResult(toolCallId, {
                success: true,
                message: 'Changes applied successfully',
                file: editedFile,
            });
            resolvePendingToolCall(toolCallId, 'applied', panel);
            // Log tool approval to backend
            const tcApprove = readTrialConfig();
            if (tcApprove?.participant_id) {
                logChatMessage(tcApprove.participant_id, 'tool_result', JSON.stringify({
                    action: 'approved',
                    tool_call_id: toolCallId,
                    tool_name: toolName,
                    args: args,
                }));
            }
            // Show success message in chat
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'system',
                content: `Changes applied successfully to ${editedFile}`,
            });
        }
        else {
            appendToolResult(toolCallId, {
                success: false,
                message: `Unsupported tool: ${toolName}`,
            });
            resolvePendingToolCall(toolCallId, 'failed', panel);
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'error',
                content: `Unsupported tool requested: ${toolName}`,
            });
        }
    }
    catch (error) {
        console.error('Failed to apply tool call:', error);
        appendToolResult(toolCallId, {
            success: false,
            message: `Failed to apply changes: ${error.message}`,
        });
        resolvePendingToolCall(toolCallId, 'failed', panel);
        vscode.window.showErrorMessage(`Failed to apply tool call: ${error.message}`);
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'error',
            content: `Error applying changes: ${error.message}`,
        });
    }
}
async function handleRejectToolCall(toolCallId, panel) {
    const pending = pendingToolCalls.get(toolCallId);
    if (!pending || pending.status !== 'pending') {
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'system',
            content: 'That edit has already been resolved.',
        });
        return;
    }
    // Add rejection to conversation history with tool_call_id
    appendToolResult(toolCallId, {
        success: false,
        message: 'User rejected the proposed changes',
    });
    resolvePendingToolCall(toolCallId, 'rejected', panel);
    // Log tool rejection to backend
    const tcReject = readTrialConfig();
    if (tcReject?.participant_id) {
        logChatMessage(tcReject.participant_id, 'tool_result', JSON.stringify({
            action: 'rejected',
            tool_call_id: toolCallId,
        }));
    }
    panel.webview.postMessage({
        command: 'addMessage',
        role: 'system',
        content: '✗ Changes rejected',
    });
}
function getWebviewContent(webview, extensionUri) {
    const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js'));
    const purifyUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'dompurify', 'dist', 'purify.min.js'));
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    #toolbar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    h2 { font-size: 14px; font-weight: 600; }

    .toolbar-buttons {
      display: flex;
      gap: 8px;
    }

    #file-context {
      padding: 8px 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      display: none;
    }

    #file-context.visible { display: block; }

    .file-badge {
      display: inline-block;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 4px;
      margin: 2px 4px 2px 0;
      font-size: 11px;
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      padding: 12px 16px;
      border-radius: 8px;
      max-width: 85%;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .user {
      background: var(--vscode-input-background);
      align-self: flex-end;
    }

    .assistant {
      background: var(--vscode-editor-inactiveSelectionBackground);
      align-self: flex-start;
    }

    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      align-self: flex-start;
    }

    .system {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      align-self: center;
      font-size: 0.9em;
    }

    .typing {
      display: none;
      padding: 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      max-width: 85%;
      align-self: flex-start;
    }

    .typing.show { display: block; }
    .typing span { animation: blink 1.4s infinite; }
    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes blink {
      0%, 60%, 100% { opacity: 1; }
      30% { opacity: 0.3; }
    }

    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 8px 0;
    }

    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }

    .markdown-body { white-space: normal; }
    .markdown-body > *:first-child { margin-top: 0; }
    .markdown-body > *:last-child { margin-bottom: 0; }
    .markdown-body p { margin: 0 0 8px 0; }
    .markdown-body h1,
    .markdown-body h2,
    .markdown-body h3,
    .markdown-body h4,
    .markdown-body h5,
    .markdown-body h6 {
      margin: 12px 0 6px 0;
      font-weight: 600;
      line-height: 1.3;
    }
    .markdown-body h1 { font-size: 1.4em; }
    .markdown-body h2 { font-size: 1.25em; }
    .markdown-body h3 { font-size: 1.1em; }
    .markdown-body h4, .markdown-body h5, .markdown-body h6 { font-size: 1em; }
    .markdown-body ul, .markdown-body ol { margin: 4px 0 8px 0; padding-left: 24px; }
    .markdown-body li { margin: 2px 0; }
    .markdown-body blockquote {
      margin: 8px 0;
      padding: 4px 12px;
      border-left: 3px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }
    .markdown-body a { color: var(--vscode-textLink-foreground); }
    .markdown-body hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 12px 0;
    }
    .markdown-body code:not(pre code) {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .markdown-body table {
      border-collapse: collapse;
      margin: 8px 0;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid var(--vscode-panel-border);
      padding: 4px 8px;
    }

    #input-area {
      padding: 16px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 8px;
    }

    #input {
      flex: 1;
      padding: 8px 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-family: inherit;
      font-size: 14px;
      resize: none;
      min-height: 36px;
    }

    #input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .clear-btn {
      background: transparent;
      padding: 4px 8px;
      font-size: 12px;
    }

    .tool-call {
      border: 2px solid var(--vscode-button-background);
      background: var(--vscode-editor-background);
    }

    .tool-call-header {
      font-size: 13px;
      margin-bottom: 8px;
      color: var(--vscode-button-background);
    }

    .tool-call-description {
      margin: 8px 0;
      font-style: italic;
    }

    .tool-call-file {
      margin: 8px 0;
      font-size: 12px;
    }

    .tool-call-diff {
      margin: 12px 0;
      max-height: 300px;
      overflow-y: auto;
    }

    .tool-call-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .approve-btn, .reject-btn {
      padding: 6px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }

    .approve-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .approve-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .reject-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .reject-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .approved {
      color: var(--vscode-testing-iconPassed);
      font-weight: 500;
    }

    .rejected {
      color: var(--vscode-testing-iconFailed);
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <h2>Human Study Chat Assistant</h2>
    <div class="toolbar-buttons">
      <button class="clear-btn" id="select-files-btn">+ Files</button>
      <button class="clear-btn" id="clear-files-btn">Clear Files</button>
      <button class="clear-btn" id="clear-chat-btn">Clear Chat</button>
    </div>
  </div>

  <div id="file-context">
    <strong>Context files:</strong> <span id="file-list"></span>
  </div>

  <div id="messages">
    <div class="message system">Welcome! Ask me anything or request code changes.</div>
  </div>

  <div class="typing" id="typing">
    <span>●</span> <span>●</span> <span>●</span>
  </div>

  <div id="input-area">
    <textarea id="input" placeholder="Type your message..." rows="1"></textarea>
    <button id="send-btn">Send</button>
  </div>

  <script src="${markedUri}"></script>
  <script src="${purifyUri}"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const typing = document.getElementById('typing');
    const sendBtn = document.getElementById('send-btn');
    const selectFilesBtn = document.getElementById('select-files-btn');
    const clearFilesBtn = document.getElementById('clear-files-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    let inputEnabled = true;

    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });

    sendBtn.addEventListener('click', send);
    selectFilesBtn.addEventListener('click', selectFiles);
    clearFilesBtn.addEventListener('click', clearFiles);
    clearChatBtn.addEventListener('click', clearChat);

    // Event delegation for dynamically created approve/reject buttons
    messages.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('approve-btn')) {
        const toolCallId = target.dataset.toolCallId;
        const toolName = target.dataset.toolName;
        const argsJson = decodeURIComponent(target.dataset.args);
        approveToolCall(toolCallId, toolName, argsJson);
      } else if (target.classList.contains('reject-btn')) {
        const toolCallId = target.dataset.toolCallId;
        rejectToolCall(toolCallId);
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    function send() {
      console.log('Send button clicked');
      if (!inputEnabled) return;
      const text = input.value.trim();
      console.log('Message text:', text);
      if (!text) return;

      console.log('Posting message to extension');
      vscode.postMessage({ command: 'sendMessage', text });
      input.value = '';
      input.style.height = 'auto';
    }

    function clearChat() {
      vscode.postMessage({ command: 'clearHistory' });
    }

    function selectFiles() {
      console.log('Select files button clicked');
      vscode.postMessage({ command: 'selectFiles' });
    }

    function clearFiles() {
      vscode.postMessage({ command: 'clearFiles' });
    }

    function setInputEnabled(enabled, reason) {
      inputEnabled = enabled;
      input.disabled = !enabled;
      sendBtn.disabled = !enabled;
      input.placeholder = enabled ? 'Type your message...' : (reason || 'Please wait...');
    }

    function escapeHtml(content) {
      return String(content ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    function renderMarkdown(content) {
      if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
        const fallback = content.replace(
          /\`\`\`([\\w]*)?\\n([\\s\\S]*?)\`\`\`/g,
          '<pre><code>$2</code></pre>'
        );
        return fallback;
      }
      const rawHtml = marked.parse(content, { breaks: true, gfm: true });
      return DOMPurify.sanitize(rawHtml);
    }

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'message ' + role;

      if (role === 'assistant') {
        div.classList.add('markdown-body');
        div.innerHTML = renderMarkdown(content);
      } else {
        const formatted = escapeHtml(content).replace(
          /\`\`\`([\\w]*)?\\n([\\s\\S]*?)\`\`\`/g,
          '<pre><code>$2</code></pre>'
        );
        div.innerHTML = formatted;
      }
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function updateFileList(files) {
      const fileContext = document.getElementById('file-context');
      const fileList = document.getElementById('file-list');

      if (files.length === 0) {
        fileContext.classList.remove('visible');
        fileList.innerHTML = '';
      } else {
        fileContext.classList.add('visible');
        fileList.innerHTML = files.map(f => {
          const name = f.split('/').pop() || f;
          return '<span class="file-badge">' + escapeHtml(name) + '</span>';
        }).join('');
      }
    }

    let streamingMessage = null;

    function startStreaming() {
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.id = 'streaming-message';
      div.innerHTML = '';
      messages.appendChild(div);
      streamingMessage = div;
      messages.scrollTop = messages.scrollHeight;
    }

    function appendStreamChunk(content) {
      if (streamingMessage) {
        streamingMessage.textContent += content;
        messages.scrollTop = messages.scrollHeight;
      }
    }

    function endStreaming() {
      if (streamingMessage) {
        const content = streamingMessage.textContent;
        streamingMessage.classList.add('markdown-body');
        streamingMessage.innerHTML = renderMarkdown(content);
        streamingMessage.id = '';
        streamingMessage = null;
      }
    }

    function showToolCall(toolCallId, toolName, args) {
      const div = document.createElement('div');
      div.className = 'message assistant tool-call';
      div.dataset.toolCallId = toolCallId;

      let content = '<div class="tool-call-header"><strong>🔧 Proposed Edit</strong></div>';

      if (toolName === 'edit_file') {
        content += '<div class="tool-call-description">' + escapeHtml(args.description) + '</div>';
        content += '<div class="tool-call-file">File: <code>' + escapeHtml(args.file_path) + '</code></div>';
        content += '<div class="tool-call-diff"><pre><code>' + escapeHtml(args.diff) + '</code></pre></div>';

        content += '<div class="tool-call-actions">';
        content += '<button class="approve-btn" data-tool-call-id="' + toolCallId + '" data-tool-name="' + toolName + '" data-args="' + encodeURIComponent(JSON.stringify(args)) + '">✓ Approve</button>';
        content += '<button class="reject-btn" data-tool-call-id="' + toolCallId + '">✗ Reject</button>';
        content += '</div>';
      }

      div.innerHTML = content;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function approveToolCall(toolCallId, toolName, argsJson) {
      const args = JSON.parse(argsJson);
      vscode.postMessage({
        command: 'approveToolCall',
        toolCallId: toolCallId,
        toolName: toolName,
        args: args
      });

      // Update UI to show approval
      const toolCallDiv = document.querySelector('[data-tool-call-id="' + toolCallId + '"]');
      if (toolCallDiv) {
        const actionsDiv = toolCallDiv.querySelector('.tool-call-actions');
        if (actionsDiv) {
          actionsDiv.innerHTML = '<span class="approved">✓ Approved - Applying changes...</span>';
        }
      }
    }

    function rejectToolCall(toolCallId) {
      vscode.postMessage({
        command: 'rejectToolCall',
        toolCallId: toolCallId
      });

      // Update UI to show rejection
      const toolCallDiv = document.querySelector('[data-tool-call-id="' + toolCallId + '"]');
      if (toolCallDiv) {
        const actionsDiv = toolCallDiv.querySelector('.tool-call-actions');
        if (actionsDiv) {
          actionsDiv.innerHTML = '<span class="rejected">✗ Rejected</span>';
        }
      }
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.command) {
        case 'addMessage':
          addMessage(msg.role, msg.content);
          break;
        case 'showTyping':
          typing.classList.add('show');
          break;
        case 'hideTyping':
          typing.classList.remove('show');
          break;
        case 'clearChat':
          messages.innerHTML = '<div class="message system">Chat cleared.</div>';
          break;
        case 'updateFileList':
          updateFileList(msg.files);
          break;
        case 'startStreaming':
          startStreaming();
          break;
        case 'streamChunk':
          appendStreamChunk(msg.content);
          break;
        case 'endStreaming':
          endStreaming();
          break;
        case 'showToolCall':
          showToolCall(msg.toolCallId, msg.toolName, msg.args);
          break;
        case 'setInputEnabled':
          setInputEnabled(msg.enabled, msg.reason);
          break;
      }
    });
  </script>
</body>
</html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map