# Code Liner — AI Code Explainer for VS Code

A VS Code extension that explains your code **line by line**, right inside the editor.
Perfect for beginners learning to code by watching videos or reading tutorials.

---

## What it does

| Action | Result |
|--------|--------|
| **Hover** over any word | Tooltip explaining what that word/function/library is |
| **Press Enter** after a line | Ghost text appears at the end of the line with a simple explanation |
| **Ctrl+Shift+E** | Explain the line your cursor is on |
| **Explain Entire File** command | Explain every line in the file |
| **Show Panel** command | Open a side-by-side view: code on the left, explanations on the right |

### Example

```python
import langgraph           # ← langgraph is a library for building stateful AI workflows using graphs
from typing import List    # ← imports 'List' from Python's typing module, used to declare list types

def greet(name: str):      # ← defines a function called 'greet' that takes a name (text) as input
    print("Hello", name)   # ← prints "Hello" followed by the name to the terminal
```

---

## Installation

### Step 1 — Get an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign in or create a free account
3. Go to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-...`)

### Step 2 — Install the extension

**Option A — Install from .vsix file (recommended)**

```bash
# In the project folder:
npm install
npm run compile
npx vsce package --no-dependencies

# Then in VS Code:
# Press Ctrl+Shift+P → "Extensions: Install from VSIX..."
# Select the generated code-liner-0.1.0.vsix file
```

**Option B — Run in development mode**

```bash
# In the project folder:
npm install
npm run compile

# Open the folder in VS Code, then press F5
# A new VS Code window opens with the extension loaded
```

### Step 3 — Add your API key

1. In VS Code, press `Ctrl+,` to open Settings
2. Search for `Code Liner`
3. Paste your API key in **Code Liner: Api Key**

Or set it as an environment variable before launching VS Code:

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
code .
```

---

## Features

### Inline Ghost Text (on Enter)
Every time you finish typing a line and press Enter, Code Liner silently sends that line to Claude AI and shows a faded explanation at the end of the line.

### Hover Tooltips
Hover your mouse over **any word** — a function name, a library name, a keyword, an operator — and a tooltip appears explaining what it is and how it's used.

### Side Panel
Open a split view showing your code and its explanations side by side:
- Press `Ctrl+Shift+P` → `Code Liner: Show Explanation Panel`

### Works with any language
Python, JavaScript, TypeScript, Rust, Go, Java, C++, SQL, Bash — anything VS Code supports.

---

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Code Liner: Explain Current Line` | `Ctrl+Shift+E` | Explain the line your cursor is on |
| `Code Liner: Explain Entire File` | — | Explain all lines in the current file |
| `Code Liner: Clear All Explanations` | `Ctrl+Shift+X` | Remove all ghost text from the current file |
| `Code Liner: Toggle On/Off` | — | Enable or disable the extension |
| `Code Liner: Show Explanation Panel` | — | Open the side-by-side explanation panel |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codeLiner.apiKey` | `""` | Your Anthropic API key |
| `codeLiner.enabled` | `true` | Enable/disable the extension |
| `codeLiner.model` | `claude-haiku-4-5-20251001` | AI model (`haiku` = fast, `sonnet` = detailed) |
| `codeLiner.showInlineExplanations` | `true` | Show ghost text after pressing Enter |
| `codeLiner.inlineExplanationTrigger` | `onEnter` | When to show inline explanations: `onEnter`, `onSave`, or `manual` |

---

## Tips

- **Learning from a video?** Open a new `.py` or `.js` file, type each line as you see it, and press Enter. The explanation appears instantly.
- **Don't understand a library name?** Just hover over it.
- **Too many explanations?** Press `Ctrl+Shift+X` to clear them all.
- **Want more detail?** Switch the model to `claude-sonnet-4-5-20250929` in settings.
- **Slow internet?** Explanations are cached — the same line is never explained twice.
