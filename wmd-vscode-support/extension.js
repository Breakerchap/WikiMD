const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const vscode = require("vscode");
const { computeSmartPairAction } = require("./smart-edit");

const PREVIEW_PORT = 4312;
let previewProcess = null;
let previewFilePath = "";
let outputChannel = null;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("WMD Preview");
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "wmd",
      {
        provideCompletionItems(document, position) {
          const linePrefix = document.lineAt(position).text.slice(0, position.character);
          const items = [];

          function item(label, detail, insertText, kind = vscode.CompletionItemKind.Snippet) {
            const completion = new vscode.CompletionItem(label, kind);
            completion.detail = detail;
            completion.insertText = new vscode.SnippetString(insertText);
            items.push(completion);
          }

          if (linePrefix.trim().startsWith("@") || linePrefix.trim() === "") {
            item("@tab", "WMD tab", "@tab ${1:Tab Name}\n@title ${2:Title}\n\n# ${3:Heading}\n\n$0");
            item("@title", "WMD tab title", "@title ${1:Title}");
            item("@config", "WMD config block", "@config\nfont: ${1:Arial, sans-serif}\nmonoFont: ${2:Consolas, monospace}\nbaseSize: ${3:16px}\ntitleSize: ${4:3rem}\nh1Size: ${5:2rem}\nh2Size: ${6:1.5rem}\nh3Size: ${7:1.25rem}\nlineHeight: ${8:1.6}\ncontentWidth: ${9:900px}\n@endconfig\n\n$0");
          }

          item("yellow highlight", "WMD highlight", "=${1:yellow note}=");
          item("orange highlight", "WMD highlight", "==${1:important note}==");
          item("red highlight", "WMD highlight", "===${1:warning note}===");
          item("wiki link", "WMD link", "[[${1:Tab Name}${2:#Heading}|${3:Label}]]");
          item("wiki link bare", "WMD link", "[[${1:Tab Name}${2:#Heading}]]");
          item("bold", "WMD bold", "*${1:bold text}*");
          item("italic", "WMD italic", "_${1:italic text}_");

          return items;
        }
      },
      "@", "[", "=", "*", "_"
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("wmd", {
      provideDocumentFormattingEdits(document) {
        const text = document.getText();
        const formatted = formatWmd(text);
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length)
        );

        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wmd.openLivePreview", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "wmd") {
        vscode.window.showWarningMessage("Open a .wmd file first.");
        return;
      }

      await editor.document.save();
      await startOrRestartPreview(editor.document);
      await vscode.commands.executeCommand("simpleBrowser.show", `http://127.0.0.1:${PREVIEW_PORT}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("type", async (args) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "wmd") {
        await vscode.commands.executeCommand("default:type", args);
        return;
      }

      const action = getSmartTypingAction(editor, args.text);
      if (!action) {
        await vscode.commands.executeCommand("default:type", args);
        return;
      }

      await applySmartTypingAction(editor, action, args.text);
    })
  );

  context.subscriptions.push(new vscode.Disposable(stopPreviewProcess));
}

function getSmartTypingAction(editor, text) {
  if (text.length !== 1) {
    return null;
  }

  if (!["*", "_", "=", "`"].includes(text)) {
    return null;
  }

  const selection = editor.selection;
  const line = editor.document.lineAt(selection.active.line).text;
  const before = selection.isEmpty && selection.active.character > 0
    ? line[selection.active.character - 1]
    : "";
  const after = selection.isEmpty && selection.active.character < line.length
    ? line[selection.active.character]
    : "";

  return computeSmartPairAction(text, before, after, !selection.isEmpty);
}

async function applySmartTypingAction(editor, action, text) {
  if (action.type === "skip") {
    const position = editor.selection.active.translate(0, 1);
    editor.selection = new vscode.Selection(position, position);
    return;
  }

  if (action.type === "insert") {
    await vscode.commands.executeCommand("default:type", { text: action.text || text });
    return;
  }

  if (action.type === "pair") {
    await editor.insertSnippet(new vscode.SnippetString(`${action.open}$0${action.close}`), editor.selection);
    return;
  }

  if (action.type === "wrap") {
    await editor.insertSnippet(new vscode.SnippetString(`${action.open}$TM_SELECTED_TEXT${action.close}`), editor.selections);
    return;
  }

  await vscode.commands.executeCommand("default:type", { text });
}

async function startOrRestartPreview(document) {
  const compilerPath = findCompilerPath();
  if (!compilerPath) {
    vscode.window.showErrorMessage("Could not find wmd-compiler.js for live preview.");
    return;
  }

  const inputPath = document.fileName;
  const parsed = path.parse(inputPath);
  const outputPath = path.join(parsed.dir, `${parsed.name}.html`);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(compilerPath);

  if (previewProcess && previewFilePath === inputPath) {
    return;
  }

  stopPreviewProcess();
  previewFilePath = inputPath;
  outputChannel.clear();
  outputChannel.appendLine(`Starting preview for ${path.basename(inputPath)}`);

  previewProcess = cp.spawn(
    process.execPath,
    [compilerPath, "--serve", "--watch", inputPath, outputPath, "--port", String(PREVIEW_PORT)],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  previewProcess.stdout.on("data", (chunk) => {
    outputChannel.append(chunk.toString());
  });

  previewProcess.stderr.on("data", (chunk) => {
    outputChannel.append(chunk.toString());
  });

  previewProcess.on("exit", (code, signal) => {
    outputChannel.appendLine(`Preview stopped${code !== null ? ` (code ${code})` : ""}${signal ? ` (${signal})` : ""}`);
    previewProcess = null;
    previewFilePath = "";
  });
}

function stopPreviewProcess() {
  if (!previewProcess) {
    return;
  }

  const running = previewProcess;
  previewProcess = null;
  previewFilePath = "";
  running.kill();
}

function findCompilerPath() {
  const folders = vscode.workspace.workspaceFolders || [];

  for (const folder of folders) {
    const candidate = path.join(folder.uri.fsPath, "wmd-compiler.js");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function formatWmd(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inCodeFence = false;
  let previousWasBlank = false;

  function pushBlank() {
    if (!previousWasBlank && out.length > 0) {
      out.push("");
      previousWasBlank = true;
    }
  }

  function pushLine(line) {
    out.push(line);
    previousWasBlank = line.trim() === "";
  }

  for (let rawLine of lines) {
    let line = rawLine.replace(/\s+$/g, "");

    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      pushLine(line);
      continue;
    }

    if (inCodeFence) {
      pushLine(rawLine);
      continue;
    }

    if (/^@tab\b/.test(line)) {
      pushBlank();
      pushLine(line);
      continue;
    }

    if (/^@title\b/.test(line)) {
      pushLine(line);
      pushBlank();
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      pushBlank();
      pushLine(line);
      continue;
    }

    if (/^(!(?:note|tip|info|warning|danger|rule|example)|@collapse)\b/.test(line)) {
      pushBlank();
      pushLine(line);
      continue;
    }

    if (/^(!end|@endcollapse)\s*$/.test(line)) {
      pushLine(line);
      pushBlank();
      continue;
    }

    if (line.trim() === "---") {
      pushBlank();
      pushLine("---");
      pushBlank();
      continue;
    }

    if (/^@config\s*$/.test(line)) {
      pushBlank();
      pushLine(line);
      continue;
    }

    if (/^@endconfig\s*$/.test(line)) {
      pushLine(line);
      pushBlank();
      continue;
    }

    pushLine(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function deactivate() {
  stopPreviewProcess();
}

module.exports = {
  activate,
  deactivate,
  formatWmd,
};
