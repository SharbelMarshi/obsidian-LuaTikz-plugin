import {
  autocompletion,
  Completion,
  CompletionContext,
} from "@codemirror/autocomplete";
import { Extension } from "@codemirror/state";

const latexCommands: Completion[] = [
  {
    label: "\\begin{tikzpicture}",
    type: "keyword",
    apply:
`\\begin{tikzpicture}
  
\\end{tikzpicture}`,
    detail: "TikZ environment",
  },
  {
    label: "\\end{tikzpicture}",
    type: "keyword",
    apply: "\\end{tikzpicture}",
    detail: "End TikZ environment",
  },
  {
    label: "\\draw",
    type: "function",
    apply: "\\draw ",
    detail: "TikZ draw command",
  },
  {
    label: "\\node",
    type: "function",
    apply: "\\node ",
    detail: "TikZ node command",
  },
  {
    label: "\\coordinate",
    type: "function",
    apply: "\\coordinate ",
    detail: "TikZ coordinate",
  },
  {
    label: "\\he{}",
    type: "function",
    apply: "\\he{}",
    detail: "Hebrew text wrapper",
  },
  {
    label: "\\frac{}{}",
    type: "function",
    apply: "\\frac{}{}",
    detail: "Fraction",
  },
  {
    label: "\\cfrac{}{}",
    type: "function",
    apply: "\\cfrac{}{}",
    detail: "Display fraction",
  },
  {
    label: "\\sqrt{}",
    type: "function",
    apply: "\\sqrt{}",
    detail: "Square root",
  },
  {
    label: "\\sum_{}^{}",
    type: "function",
    apply: "\\sum_{}^{}",
    detail: "Summation",
  },
  {
    label: "\\int_{}^{}",
    type: "function",
    apply: "\\int_{}^{}",
    detail: "Integral",
  },
  {
    label: "\\alpha",
    type: "variable",
    apply: "\\alpha",
  },
  {
    label: "\\beta",
    type: "variable",
    apply: "\\beta",
  },
  {
    label: "\\gamma",
    type: "variable",
    apply: "\\gamma",
  },
  {
    label: "\\Delta",
    type: "variable",
    apply: "\\Delta",
  },
  {
    label: "\\theta",
    type: "variable",
    apply: "\\theta",
  },
];

const tikzOptions: Completion[] = [
  {
    label: "thick",
    type: "property",
    apply: "thick",
  },
  {
    label: "very thick",
    type: "property",
    apply: "very thick",
  },
  {
    label: "dashed",
    type: "property",
    apply: "dashed",
  },
  {
    label: "fill=cyan!10",
    type: "property",
    apply: "fill=cyan!10",
  },
  {
    label: "draw=black",
    type: "property",
    apply: "draw=black",
  },
  {
    label: "circle",
    type: "property",
    apply: "circle",
  },
  {
    label: "rectangle",
    type: "property",
    apply: "rectangle",
  },
  {
    label: "font=\\small",
    type: "property",
    apply: "font=\\small",
  },
  {
    label: "align=center",
    type: "property",
    apply: "align=center",
  },
  {
    label: "inner sep=2pt",
    type: "property",
    apply: "inner sep=2pt",
  },
];

function insideLatexOrTikzBlock(textBeforeCursor: string): boolean {
  const lastFence = textBeforeCursor.lastIndexOf("```");

  if (lastFence === -1) {
    return false;
  }

  const afterFence = textBeforeCursor.slice(lastFence);

  return (
    afterFence.startsWith("```tikz") ||
    afterFence.startsWith("```latex") ||
    afterFence.startsWith("```lualatex") ||
    afterFence.startsWith("```tex")
  );
}

function latexCompletionSource(context: CompletionContext) {
  const textBeforeCursor = context.state.doc.sliceString(0, context.pos);

  if (!insideLatexOrTikzBlock(textBeforeCursor)) {
    return null;
  }

  const commandMatch = context.matchBefore(/\\[A-Za-z]*/);

  if (commandMatch) {
    return {
      from: commandMatch.from,
      options: latexCommands,
      validFor: /^\\[A-Za-z]*$/,
    };
  }

  const optionMatch = context.matchBefore(/[A-Za-z!\\=0-9.-]+/);

  if (optionMatch && context.explicit) {
    return {
      from: optionMatch.from,
      options: tikzOptions,
      validFor: /^[A-Za-z!\\=0-9.-]*$/,
    };
  }

  return null;
}

export function latexAutocompleteExtension(): Extension {
  return autocompletion({
    override: [latexCompletionSource],
    activateOnTyping: true,
  });
}