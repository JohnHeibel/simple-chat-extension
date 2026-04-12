import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

interface TrialConfig {
  participant_id: string;
  scenario_id: number;
  module_filename: string;
  task_dir: string;
  title: string;
}

interface TaskInfo {
  scenario_id: number;
  task_description_md: string;
  module_filename: string;
  time_limit_secs: number;
  time_remaining_secs: number;
  task_index: number;
  total_tasks: number;
  ai_enabled: boolean;
  task_session_id: number;
}

export class TaskPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'trialTaskView';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _configWatcher?: vscode.FileSystemWatcher;
  private _onTaskChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onTaskChanged = this._onTaskChanged.event;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;

    // Watch for .trial_config.json changes (backend swaps tasks)
    this._configWatcher = vscode.workspace.createFileSystemWatcher('**/.trial_config.json');
    this._configWatcher.onDidChange(() => this._onConfigChanged());
    this._configWatcher.onDidCreate(() => this._onConfigChanged());
  }

  private _onConfigChanged() {
    // Task was changed by the backend — refresh the panel
    if (this._view) {
      this._view.webview.postMessage({ command: 'refreshTask' });
    }
    this._onTaskChanged.fire();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'loadTask':
          await this._handleLoadTask();
          break;
        case 'runTests':
          await this._handleRunTests();
          break;
        case 'submitCode':
          await this._handleSubmitCode();
          break;
        case 'timeout':
          await this._handleTimeout();
          break;
      }
    });
  }

  private _readTrialConfig(): TrialConfig | null {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) { return null; }
      const configPath = path.join(workspaceFolders[0].uri.fsPath, '.trial_config.json');
      if (!fs.existsSync(configPath)) { return null; }
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private _getBackendUrl(): string {
    const config = vscode.workspace.getConfiguration('simple-chat');
    return config.get<string>('backendUrl') || 'https://code.johnheibel.com';
  }

  private async _getCurrentCode(): Promise<string> {
    const trialConfig = this._readTrialConfig();
    if (!trialConfig) { return ''; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return ''; }

    const codePath = path.join(
      workspaceFolders[0].uri.fsPath,
      trialConfig.task_dir,
      trialConfig.module_filename,
    );

    // Try to get content from the active editor first (unsaved changes)
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.fsPath === codePath) {
        return doc.getText();
      }
    }

    // Fall back to reading from disk
    try {
      return fs.readFileSync(codePath, 'utf-8');
    } catch {
      return '';
    }
  }

  private async _handleLoadTask() {
    const trialConfig = this._readTrialConfig();
    if (!trialConfig?.participant_id) {
      this._view?.webview.postMessage({
        command: 'taskLoaded',
        data: null,
        error: 'No trial configuration found. Waiting for study to start...',
      });
      return;
    }

    try {
      const backendUrl = this._getBackendUrl();
      const response = await axios.get(
        `${backendUrl}/api/tasks/current/${trialConfig.participant_id}`
      );
      this._view?.webview.postMessage({
        command: 'taskLoaded',
        data: response.data,
      });
    } catch (error: any) {
      this._view?.webview.postMessage({
        command: 'taskLoaded',
        data: null,
        error: error.response?.data?.detail || error.message || 'Failed to load task',
      });
    }
  }

  private async _handleRunTests() {
    const trialConfig = this._readTrialConfig();
    if (!trialConfig?.participant_id) { return; }

    const code = await this._getCurrentCode();
    if (!code) {
      this._view?.webview.postMessage({
        command: 'testResults',
        data: null,
        error: 'No code found to test',
      });
      return;
    }

    try {
      const backendUrl = this._getBackendUrl();
      const response = await axios.post(
        `${backendUrl}/api/tasks/run-tests/${trialConfig.participant_id}`,
        { code },
      );
      this._view?.webview.postMessage({
        command: 'testResults',
        data: response.data,
      });
    } catch (error: any) {
      this._view?.webview.postMessage({
        command: 'testResults',
        data: null,
        error: error.response?.data?.detail || error.message || 'Failed to run tests',
      });
    }
  }

  private async _handleSubmitCode() {
    const trialConfig = this._readTrialConfig();
    if (!trialConfig?.participant_id) { return; }

    const code = await this._getCurrentCode();

    try {
      const backendUrl = this._getBackendUrl();
      const response = await axios.post(
        `${backendUrl}/api/tasks/submit/${trialConfig.participant_id}`,
        { code },
      );

      const result = response.data;
      this._view?.webview.postMessage({
        command: 'submitResult',
        data: result,
      });

      if (result.completed) {
        vscode.window.showInformationMessage('All tasks completed! Thank you for participating.');
      } else if (result.advanced) {
        // Task advanced — the config watcher will trigger a refresh
        // Clear chat history via event
        this._onTaskChanged.fire();
        vscode.window.showInformationMessage('Task submitted! Moving to next task...');
      }
    } catch (error: any) {
      this._view?.webview.postMessage({
        command: 'submitResult',
        data: null,
        error: error.response?.data?.detail || error.message || 'Failed to submit',
      });
    }
  }

  private async _handleTimeout() {
    const trialConfig = this._readTrialConfig();
    if (!trialConfig?.participant_id) { return; }

    try {
      const backendUrl = this._getBackendUrl();
      await axios.post(
        `${backendUrl}/api/tasks/timeout/${trialConfig.participant_id}`
      );
      this._onTaskChanged.fire();
      vscode.window.showWarningMessage('Time is up! Moving to next task...');
    } catch (error: any) {
      console.error('Timeout handler error:', error);
    }
  }

  dispose() {
    this._configWatcher?.dispose();
  }

  private _getHtml(): string {
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
      background: var(--vscode-sideBar-background);
      padding: 12px;
      font-size: 13px;
    }
    h2 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
    h3 { font-size: 13px; font-weight: 600; margin: 12px 0 6px 0; }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .timer {
      font-size: 16px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-foreground);
    }
    .timer.warning { color: var(--vscode-editorWarning-foreground); }
    .timer.critical { color: var(--vscode-errorForeground); }

    .progress {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }

    .description {
      max-height: 300px;
      overflow-y: auto;
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
      margin-bottom: 12px;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    button {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-test {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-test:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn-submit {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-submit:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    .results {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      margin-top: 8px;
    }

    .result-summary {
      font-weight: 600;
      margin-bottom: 6px;
    }
    .result-summary.all-pass { color: var(--vscode-testing-iconPassed); }
    .result-summary.some-fail { color: var(--vscode-testing-iconFailed); }

    .test-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      font-size: 12px;
    }
    .test-pass { color: var(--vscode-testing-iconPassed); }
    .test-fail { color: var(--vscode-testing-iconFailed); }

    .status-msg {
      padding: 12px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .completed-msg {
      padding: 20px;
      text-align: center;
      background: var(--vscode-editor-background);
      border-radius: 8px;
      margin-top: 20px;
    }
    .completed-msg h2 { font-size: 16px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div id="loading" class="status-msg">Loading task...</div>
  <div id="task-content" style="display:none;">
    <div class="header">
      <div>
        <div class="progress" id="task-progress"></div>
        <h2 id="task-title"></h2>
      </div>
      <div class="timer" id="timer">--:--</div>
    </div>

    <div class="description" id="task-description"></div>

    <div class="actions">
      <button class="btn-test" id="btn-run-tests">Run Tests</button>
      <button class="btn-submit" id="btn-submit">Submit</button>
    </div>

    <div id="results-area"></div>
  </div>

  <div id="completed" class="completed-msg" style="display:none;">
    <h2>All Tasks Complete</h2>
    <p>Thank you for participating in this study!</p>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    let timerInterval = null;
    let timeRemaining = 0;
    let isLoading = false;

    // Request task data on load
    vscode.postMessage({ command: 'loadTask' });

    document.getElementById('btn-run-tests').addEventListener('click', () => {
      if (isLoading) return;
      isLoading = true;
      document.getElementById('btn-run-tests').disabled = true;
      document.getElementById('btn-run-tests').textContent = 'Running...';
      vscode.postMessage({ command: 'runTests' });
    });

    document.getElementById('btn-submit').addEventListener('click', () => {
      if (isLoading) return;
      isLoading = true;
      document.getElementById('btn-submit').disabled = true;
      document.getElementById('btn-submit').textContent = 'Submitting...';
      vscode.postMessage({ command: 'submitCode' });
    });

    function startTimer(seconds) {
      timeRemaining = seconds;
      if (timerInterval) clearInterval(timerInterval);
      updateTimerDisplay();
      timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        if (timeRemaining <= 0) {
          clearInterval(timerInterval);
          vscode.postMessage({ command: 'timeout' });
        }
      }, 1000);
    }

    function updateTimerDisplay() {
      const el = document.getElementById('timer');
      const mins = Math.max(0, Math.floor(timeRemaining / 60));
      const secs = Math.max(0, timeRemaining % 60);
      el.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

      el.className = 'timer';
      if (timeRemaining <= 60) el.className = 'timer critical';
      else if (timeRemaining <= 300) el.className = 'timer warning';
    }

    function showTestResults(data) {
      const area = document.getElementById('results-area');
      if (!data) {
        area.innerHTML = '';
        return;
      }

      const allPass = data.tests_passed === data.tests_total;
      let html = '<div class="results">';
      html += '<div class="result-summary ' + (allPass ? 'all-pass' : 'some-fail') + '">';
      html += data.tests_passed + ' / ' + data.tests_total + ' tests passed';
      html += '</div>';

      if (data.test_details && data.test_details.length > 0) {
        for (const t of data.test_details) {
          const cls = t.passed ? 'test-pass' : 'test-fail';
          const icon = t.passed ? '\\u2713' : '\\u2717';
          html += '<div class="test-item"><span class="' + cls + '">' + icon + '</span> ' + t.name + '</div>';
        }
      }
      html += '</div>';
      area.innerHTML = html;
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.command) {
        case 'taskLoaded':
          document.getElementById('loading').style.display = 'none';
          if (msg.error) {
            document.getElementById('loading').style.display = 'block';
            document.getElementById('loading').textContent = msg.error;
            return;
          }
          if (!msg.data) return;

          document.getElementById('task-content').style.display = 'block';
          document.getElementById('completed').style.display = 'none';
          document.getElementById('task-progress').textContent =
            'Task ' + (msg.data.task_index + 1) + ' of ' + msg.data.total_tasks;
          document.getElementById('task-title').textContent =
            'Scenario ' + msg.data.scenario_id;
          document.getElementById('task-description').textContent =
            msg.data.task_description_md;
          document.getElementById('results-area').innerHTML = '';

          startTimer(msg.data.time_remaining_secs);
          break;

        case 'testResults':
          isLoading = false;
          document.getElementById('btn-run-tests').disabled = false;
          document.getElementById('btn-run-tests').textContent = 'Run Tests';
          if (msg.error) {
            document.getElementById('results-area').innerHTML =
              '<div class="results"><div class="result-summary some-fail">Error: ' + msg.error + '</div></div>';
            return;
          }
          showTestResults(msg.data);
          break;

        case 'submitResult':
          isLoading = false;
          document.getElementById('btn-submit').disabled = false;
          document.getElementById('btn-submit').textContent = 'Submit';
          if (msg.error) {
            document.getElementById('results-area').innerHTML =
              '<div class="results"><div class="result-summary some-fail">Error: ' + msg.error + '</div></div>';
            return;
          }
          if (msg.data) {
            showTestResults(msg.data);
            if (msg.data.completed) {
              document.getElementById('task-content').style.display = 'none';
              document.getElementById('completed').style.display = 'block';
              if (timerInterval) clearInterval(timerInterval);
            }
          }
          break;

        case 'refreshTask':
          // Task was changed by backend — reload
          document.getElementById('results-area').innerHTML = '';
          vscode.postMessage({ command: 'loadTask' });
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
