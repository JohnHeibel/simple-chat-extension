"use strict";
// Simple Chat Extension - VS Code chat interface with AI assistance and code diff application
// Integrates with OpenRouter API for streaming chat responses
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
const axios_1 = __importDefault(require("axios"));
const patchApplier_1 = require("./patchApplier");
let chatPanel;
let conversationHistory = [];
let selectedFiles = [];
/**
 * Returns the system prompt for the AI assistant.
 * Fetches from a network source (Pastebin).
 */
async function return_system_prompt() {
    const response = await axios_1.default.get('https://pastebin.com/raw/s4db5X5V');
    return response.data;
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
            const item = new vscode.TreeItem('New Chat', vscode.TreeItemCollapsibleState.None);
            item.command = {
                command: 'simpleChat.openChat',
                title: 'Open Chat'
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
    const openChatCommand = vscode.commands.registerCommand('simpleChat.openChat', () => {
        if (chatPanel) {
            chatPanel.reveal();
            return;
        }
        chatPanel = vscode.window.createWebviewPanel('simpleChat', 'Chat', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        chatPanel.webview.html = getWebviewContent();
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
    });
    context.subscriptions.push(configureCommand, selectFilesCommand, clearFilesCommand, openChatCommand);
}
async function handleSendMessage(userMessage, context, panel) {
    try {
        let config = context.globalState.get('config');
        // Use hardcoded defaults if not configured
        if (!config) {
            config = {
                apiKey: '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',
                model: 'anthropic/claude-sonnet-4.5',
                baseUrl: 'https://openrouter.ai/api/v1',
            };
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
        let currentToolCall = null;
        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                if (line.includes('[DONE]')) {
                    continue;
                }
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
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
                        // Skip invalid JSON
                    }
                }
            }
        });
        await new Promise((resolve, reject) => {
            response.data.on('end', () => {
                console.log('Stream ended. Tool calls count:', toolCalls.length);
                console.log('Tool calls:', JSON.stringify(toolCalls, null, 2));
                // Build the assistant message for conversation history
                const assistantHistoryMessage = {
                    role: 'assistant',
                    content: assistantMessage || null,
                };
                if (toolCalls.length > 0) {
                    assistantHistoryMessage.tool_calls = toolCalls;
                }
                conversationHistory.push(assistantHistoryMessage);
                panel.webview.postMessage({ command: 'endStreaming' });
                // If there are tool calls, show them for approval
                if (toolCalls.length > 0) {
                    // Show visual indicator that tool calls are being prepared
                    panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'system',
                        content: '🔧 Preparing file edit...',
                    });
                    for (const toolCall of toolCalls) {
                        try {
                            console.log('Parsing tool call arguments:', toolCall.function.arguments);
                            // Try to repair common JSON issues
                            let argsString = toolCall.function.arguments;
                            // Fix missing colon and quote after keys: "key value" => "key":"value"
                            // This handles cases like "diff--- => "diff":"---
                            argsString = argsString.replace(/"(\w+)"(?!:)(\S)/g, '"$1":"$2');
                            console.log('Repaired arguments:', argsString);
                            const args = JSON.parse(argsString);
                            panel.webview.postMessage({
                                command: 'showToolCall',
                                toolCallId: toolCall.id,
                                toolName: toolCall.function.name,
                                args: args,
                            });
                        }
                        catch (parseError) {
                            console.error('Failed to parse tool call arguments:', parseError.message);
                            console.error('Arguments string:', toolCall.function.arguments);
                            panel.webview.postMessage({
                                command: 'addMessage',
                                role: 'error',
                                content: `Failed to parse tool call: ${parseError.message}`,
                            });
                        }
                    }
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
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'error',
            content: `Error: ${error.message}`,
        });
    }
}
async function handleApplyDiff(diffContent) {
    // Extract file path from diff headers
    const lines = diffContent.split('\n');
    let filePath = '';
    for (const line of lines) {
        if (line.startsWith('--- ')) {
            filePath = line.substring(4).replace(/^a\//, '').replace(/^b\//, '');
            break;
        }
    }
    if (!filePath) {
        throw new Error('Could not determine file path from diff');
    }
    // Normalize path
    let normalizedPath = filePath;
    // Handle missing leading slash (e.g., "Users/..." should be "/Users/...")
    if (!normalizedPath.startsWith('/') && !normalizedPath.startsWith('.') &&
        (normalizedPath.startsWith('Users/') || normalizedPath.startsWith('home/') ||
            normalizedPath.includes(':/') || /^[A-Za-z]:[\\/]/.test(normalizedPath))) {
        normalizedPath = '/' + normalizedPath;
    }
    // Determine if path is absolute
    const isAbsolute = normalizedPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(normalizedPath);
    let fileUri;
    if (isAbsolute) {
        fileUri = vscode.Uri.file(normalizedPath);
    }
    else {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        fileUri = vscode.Uri.joinPath(workspaceFolder.uri, normalizedPath);
    }
    // Read original content
    let originalContent;
    try {
        const content = await vscode.workspace.fs.readFile(fileUri);
        originalContent = Buffer.from(content).toString('utf8');
    }
    catch (error) {
        throw new Error(`Failed to read file ${normalizedPath}: ${error.message}`);
    }
    // Apply patch using the reliable patch applier
    const result = (0, patchApplier_1.applyPatch)(originalContent, diffContent);
    if (!result.success) {
        throw new Error(result.error || 'Failed to apply patch');
    }
    // Write new content
    try {
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(result.newContent, 'utf8'));
        vscode.window.showInformationMessage(`Applied changes to ${normalizedPath}`);
    }
    catch (error) {
        throw new Error(`Failed to write file ${normalizedPath}: ${error.message}`);
    }
}
async function handleApproveToolCall(toolCallId, toolName, args, context, panel) {
    try {
        if (toolName === 'edit_file') {
            // Apply the diff
            await handleApplyDiff(args.diff);
            // Add tool response to conversation history with tool_call_id
            conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify({ success: true, message: 'Changes applied successfully' }),
            });
            // Show success message in chat
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'system',
                content: '✓ Changes applied successfully',
            });
        }
    }
    catch (error) {
        console.error('Failed to apply tool call:', error);
        vscode.window.showErrorMessage(`Failed to apply tool call: ${error.message}`);
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'error',
            content: `Error applying changes: ${error.message}`,
        });
    }
}
async function handleRejectToolCall(toolCallId, panel) {
    // Add rejection to conversation history with tool_call_id
    conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({ success: false, message: 'User rejected the proposed changes' }),
    });
    panel.webview.postMessage({
        command: 'addMessage',
        role: 'system',
        content: '✗ Changes rejected',
    });
}
function getWebviewContent() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
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
    <h2>Chat</h2>
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

  <script>
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const typing = document.getElementById('typing');
    const sendBtn = document.getElementById('send-btn');
    const selectFilesBtn = document.getElementById('select-files-btn');
    const clearFilesBtn = document.getElementById('clear-files-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');

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

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'message ' + role;

      const formatted = content.replace(
        /\`\`\`([\\w]*)?\\n([\\s\\S]*?)\`\`\`/g,
        '<pre><code>$2</code></pre>'
      );

      div.innerHTML = formatted;
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
          return '<span class="file-badge">' + name + '</span>';
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

        // Format the content
        const formatted = content.replace(
          /\`\`\`([\\w]*)?\\n([\\s\\S]*?)\`\`\`/g,
          '<pre><code>$2</code></pre>'
        );

        streamingMessage.innerHTML = formatted;
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
        content += '<div class="tool-call-description">' + args.description + '</div>';
        content += '<div class="tool-call-file">File: <code>' + args.file_path + '</code></div>';
        content += '<div class="tool-call-diff"><pre><code>' + args.diff + '</code></pre></div>';

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
      }
    });
  </script>
</body>
</html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map