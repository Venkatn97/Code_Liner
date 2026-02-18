import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';

// ─── State ────────────────────────────────────────────────────────────────────

let client: Anthropic | null = null;

// Cache: code string → explanation  (avoids calling API for same code twice)
const explanationCache = new Map<string, string>();

// Per-document explanations: uri → (lineNumber → explanation text)
const documentExplanations = new Map<string, Map<number, string>>();

// Decoration type for inline ghost text shown after each line
let inlineDecoration: vscode.TextEditorDecorationType;

// Panel for the side-by-side explanation view
let explanationPanel: vscode.WebviewPanel | undefined;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClient(): Anthropic | null {
  const config = vscode.workspace.getConfiguration('codeLiner');
  const apiKey =
    config.get<string>('apiKey')?.trim() ||
    process.env.ANTHROPIC_API_KEY ||
    '';

  if (!apiKey) return null;

  // Re-create client only when key changes
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

function resetClient(): void {
  client = null;
}

function getModel(): string {
  return (
    vscode.workspace
      .getConfiguration('codeLiner')
      .get<string>('model') || 'claude-haiku-4-5-20251001'
  );
}

/**
 * Returns ~3 lines before and after the target line so Claude has context.
 */
function getSurroundingContext(
  document: vscode.TextDocument,
  lineNum: number
): string {
  const start = Math.max(0, lineNum - 3);
  const end = Math.min(document.lineCount - 1, lineNum + 3);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const marker = i === lineNum ? '>>>' : '   ';
    lines.push(`${marker} ${document.lineAt(i).text}`);
  }
  return lines.join('\n');
}

function getLanguage(document: vscode.TextDocument): string {
  return document.languageId || 'plaintext';
}

// ─── AI Explanation ───────────────────────────────────────────────────────────

/**
 * Ask Claude to explain a single line of code.
 * Returns a short 1–2 sentence explanation.
 */
async function explainLine(
  lineText: string,
  context: string,
  language: string
): Promise<string> {
  const cacheKey = `line::${language}::${lineText}`;
  if (explanationCache.has(cacheKey)) {
    return explanationCache.get(cacheKey)!;
  }

  const anthropic = getClient();
  if (!anthropic) {
    return '⚠️ Add your API key: Settings → Code Liner → Api Key';
  }

  const prompt = `You are a friendly coding tutor explaining code to a beginner.

Language: ${language}

Surrounding code (>>> marks the target line):
${context}

Explain ONLY the line marked with >>> in plain English.
Rules:
- 1 to 2 sentences maximum.
- Explain what the line DOES, not how to code it.
- If it's an import, explain what the imported module/function is used for.
- If it calls a function or method, say what that function does.
- If it defines a variable, explain what value it holds.
- If it's a loop/condition/class, explain its purpose.
- Use simple words. No jargon unless you define it.
- Do NOT repeat the code itself.
- Reply with only the explanation, nothing else.`;

  try {
    const response = await anthropic.messages.create({
      model: getModel(),
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content[0] as { type: string; text: string }).text.trim();
    explanationCache.set(cacheKey, text);
    return text;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `⚠️ ${message}`;
  }
}

/**
 * Ask Claude to explain a specific word/token in context.
 * Used by the hover provider.
 */
async function explainWord(
  word: string,
  fullLine: string,
  language: string
): Promise<string> {
  const cacheKey = `word::${language}::${word}::${fullLine}`;
  if (explanationCache.has(cacheKey)) {
    return explanationCache.get(cacheKey)!;
  }

  const anthropic = getClient();
  if (!anthropic) {
    return '⚠️ Add your API key: Settings → Code Liner → Api Key';
  }

  const prompt = `You are a friendly coding tutor explaining code to a beginner.

Language: ${language}
Full line: \`${fullLine}\`
Word/token being hovered: \`${word}\`

Explain what \`${word}\` is and how it is being used in this specific line.
Rules:
- Keep it under 3 sentences.
- Identify what type of thing it is: keyword, built-in function, imported module, method, variable, operator, class, decorator, etc.
- Explain what it does or means in plain English.
- If it's a well-known library (like langgraph, numpy, react, etc.), briefly explain what the library does.
- Use simple words. No jargon unless you define it.
- Reply with only the explanation. No markdown headers.`;

  try {
    const response = await anthropic.messages.create({
      model: getModel(),
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content[0] as { type: string; text: string }).text.trim();
    explanationCache.set(cacheKey, text);
    return text;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `⚠️ ${message}`;
  }
}

// ─── Decorations (inline ghost text) ─────────────────────────────────────────

/**
 * Refresh the inline ghost-text decorations for a given editor.
 */
function refreshDecorations(editor: vscode.TextEditor): void {
  const uri = editor.document.uri.toString();
  const map = documentExplanations.get(uri);
  if (!map || map.size === 0) {
    editor.setDecorations(inlineDecoration, []);
    return;
  }

  const decorations: vscode.DecorationOptions[] = [];

  for (const [lineNum, explanation] of map) {
    if (lineNum >= editor.document.lineCount) continue;
    const line = editor.document.lineAt(lineNum);
    // Attach ghost text at the very end of the line
    const pos = new vscode.Position(lineNum, line.text.length);
    decorations.push({
      range: new vscode.Range(pos, pos),
      renderOptions: {
        after: {
          contentText: `   // ${explanation}`,
          color: new vscode.ThemeColor('editorCodeLens.foreground'),
          fontStyle: 'italic',
        },
      },
    });
  }

  editor.setDecorations(inlineDecoration, decorations);
}

/**
 * Set a placeholder "⏳ explaining…" decoration while the API call is in-flight.
 */
function setLoadingDecoration(editor: vscode.TextEditor, lineNum: number): void {
  const uri = editor.document.uri.toString();
  if (!documentExplanations.has(uri)) {
    documentExplanations.set(uri, new Map());
  }
  documentExplanations.get(uri)!.set(lineNum, '⏳ explaining…');
  refreshDecorations(editor);
}

// ─── Panel (side-by-side view) ────────────────────────────────────────────────

function buildPanelHtml(
  code: string,
  explanations: Map<number, string>
): string {
  const lines = code.split('\n');
  const rows = lines
    .map((line, i) => {
      const explanation = explanations.get(i) || '';
      const safeCode = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const safeExp = explanation
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `
        <tr>
          <td class="line-num">${i + 1}</td>
          <td class="code"><code>${safeCode}</code></td>
          <td class="explanation">${safeExp}</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Liner</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 12px;
    }
    h2 { margin-top: 0; }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: top;
    }
    th {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      font-weight: bold;
    }
    .line-num {
      width: 36px;
      color: var(--vscode-editorLineNumber-foreground);
      text-align: right;
      user-select: none;
    }
    .code {
      width: 45%;
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre;
    }
    .explanation {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    code { font-family: inherit; }
    tr:hover { background: var(--vscode-list-hoverBackground); }
  </style>
</head>
<body>
  <h2>Code Liner — Line by Line Explanation</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Code</th>
        <th>Explanation</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

async function showPanel(document: vscode.TextDocument): Promise<void> {
  const uri = document.uri.toString();

  if (explanationPanel) {
    explanationPanel.reveal(vscode.ViewColumn.Two);
  } else {
    explanationPanel = vscode.window.createWebviewPanel(
      'codeLinerPanel',
      'Code Liner Explanations',
      vscode.ViewColumn.Two,
      { enableScripts: false }
    );
    explanationPanel.onDidDispose(() => {
      explanationPanel = undefined;
    });
  }

  const map = documentExplanations.get(uri) || new Map<number, string>();
  explanationPanel.webview.html = buildPanelHtml(document.getText(), map);
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Explain one line and update inline ghost text + panel.
 */
async function processLine(
  document: vscode.TextDocument,
  lineNum: number
): Promise<void> {
  const lineText = document.lineAt(lineNum).text;
  const trimmed = lineText.trim();

  // Skip blank lines and very short ones (e.g. lone braces)
  if (!trimmed || trimmed.length < 2) return;

  // Skip pure comment lines — the comment itself is the explanation
  // Covers: # (Python/bash), // (JS/TS/C), /* and */ (block comments), * (inside block comments)
  if (/^(#|\/\/|\/\*|\*\/|\*\s)/.test(trimmed)) return;

  // Skip lines that are only closing delimiters (e.g. `};`, `})`, `]),`)
  if (/^[\}\]\);,]+$/.test(trimmed)) return;

  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.toString() === document.uri.toString()) {
    setLoadingDecoration(editor, lineNum);
  }

  const language = getLanguage(document);
  const context = getSurroundingContext(document, lineNum);
  const explanation = await explainLine(trimmed, context, language);

  const uri = document.uri.toString();
  if (!documentExplanations.has(uri)) {
    documentExplanations.set(uri, new Map());
  }
  documentExplanations.get(uri)!.set(lineNum, explanation);

  if (editor && editor.document.uri.toString() === uri) {
    refreshDecorations(editor);
  }

  // Update panel if open
  if (explanationPanel) {
    const map = documentExplanations.get(uri)!;
    explanationPanel.webview.html = buildPanelHtml(document.getText(), map);
  }
}

// ─── Extension Entry Point ────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Decoration type — just a placeholder; actual style is per-decoration renderOptions
  inlineDecoration = vscode.window.createTextEditorDecorationType({});

  // Invalidate client when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeLiner.apiKey') || e.affectsConfiguration('codeLiner.model')) {
        resetClient();
        explanationCache.clear();
      }
    })
  );

  // ── Hover Provider ───────────────────────────────────────────────────────────
  // Shows a tooltip when you hover over any word
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('*', {
      async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
      ): Promise<vscode.Hover | undefined> {
        const config = vscode.workspace.getConfiguration('codeLiner');
        if (!config.get<boolean>('enabled')) return undefined;

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return undefined;

        const word = document.getText(wordRange);
        if (!word || word.length < 2) return undefined;

        const fullLine = document.lineAt(position.line).text.trim();
        const language = getLanguage(document);

        const explanation = await explainWord(word, fullLine, language);

        const md = new vscode.MarkdownString(
          `**Code Liner** — \`${word}\`\n\n${explanation}`
        );
        md.isTrusted = true;
        md.supportHtml = false;

        return new vscode.Hover(md, wordRange);
      },
    })
  );

  // ── Document Change Listener ─────────────────────────────────────────────────
  // Triggers an explanation when the user presses Enter after a line
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      const config = vscode.workspace.getConfiguration('codeLiner');
      if (!config.get<boolean>('enabled')) return;

      // Always re-apply decorations after any document change (e.g. save with
      // trailing-whitespace trimming or format-on-save) so they never disappear.
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.toString() === event.document.uri.toString()) {
        refreshDecorations(activeEditor);
      }

      if (config.get<string>('inlineExplanationTrigger') !== 'onEnter') return;
      if (!config.get<boolean>('showInlineExplanations')) return;

      for (const change of event.contentChanges) {
        // A newline was inserted → user pressed Enter
        if (change.text.includes('\n')) {
          const lineNum = change.range.start.line;
          // Process asynchronously so typing isn't blocked
          processLine(event.document, lineNum).catch(() => {
            // silently swallow; error shown in decoration
          });
        }
      }
    })
  );

  // ── Save Listener ─────────────────────────────────────────────────────────────
  // If trigger is "onSave", explain all lines when the file is saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = vscode.workspace.getConfiguration('codeLiner');
      if (!config.get<boolean>('enabled')) return;
      if (config.get<string>('inlineExplanationTrigger') !== 'onSave') return;
      if (!config.get<boolean>('showInlineExplanations')) return;

      for (let i = 0; i < document.lineCount; i++) {
        await processLine(document, i);
      }
    })
  );

  // ── Editor Switch Listener ────────────────────────────────────────────────────
  // Re-apply decorations when switching between files
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) refreshDecorations(editor);
    })
  );

  // ── Commands ──────────────────────────────────────────────────────────────────

  // Ctrl+Shift+E  →  Explain the line the cursor is on
  context.subscriptions.push(
    vscode.commands.registerCommand('codeLiner.explainLine', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const lineNum = editor.selection.active.line;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Code Liner: Explaining line…',
          cancellable: false,
        },
        () => processLine(editor.document, lineNum)
      );
    })
  );

  // Explain every non-empty line in the current file
  context.subscriptions.push(
    vscode.commands.registerCommand('codeLiner.explainFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Code Liner: No active editor.');
        return;
      }

      const doc = editor.document;
      const total = doc.lineCount;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Code Liner: Explaining file…',
          cancellable: false,
        },
        async (progress) => {
          for (let i = 0; i < total; i++) {
            progress.report({
              message: `Line ${i + 1} / ${total}`,
              increment: 100 / total,
            });
            await processLine(doc, i);
          }
        }
      );

      vscode.window.showInformationMessage(
        'Code Liner: Done! All lines explained.'
      );
    })
  );

  // Ctrl+Shift+X  →  Clear all explanations for the current file
  context.subscriptions.push(
    vscode.commands.registerCommand('codeLiner.clearExplanations', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uri = editor.document.uri.toString();
      documentExplanations.delete(uri);
      editor.setDecorations(inlineDecoration, []);

      vscode.window.showInformationMessage(
        'Code Liner: Explanations cleared.'
      );
    })
  );

  // Toggle the extension on/off
  context.subscriptions.push(
    vscode.commands.registerCommand('codeLiner.toggle', () => {
      const config = vscode.workspace.getConfiguration('codeLiner');
      const current = config.get<boolean>('enabled') ?? true;
      config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Code Liner: ${!current ? 'Enabled ✓' : 'Disabled ✗'}`
      );
    })
  );

  // Open the side-by-side webview panel with code + explanations
  context.subscriptions.push(
    vscode.commands.registerCommand('codeLiner.showPanel', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Code Liner: No active editor.');
        return;
      }
      showPanel(editor.document);
    })
  );

  // Push the decoration type into subscriptions so it's disposed on deactivate
  context.subscriptions.push(inlineDecoration);

  vscode.window.showInformationMessage(
    'Code Liner is active! Type code and press Enter, or hover over any word.'
  );
}

export function deactivate(): void {
  client = null;
  explanationCache.clear();
  documentExplanations.clear();
  explanationPanel = undefined;
}
