export const SIMPLE_TIKZ_HELPERS = String.raw`
% ---------- Simple drawing helpers ----------
\def\Circle(#1,#2,#3){\draw (#1,#2) circle (#3);}
\def\FilledCircle(#1,#2,#3){\fill (#1,#2) circle (#3);}
\def\Point(#1,#2){\fill (#1,#2) circle (1.7pt);}
\def\Line(#1,#2,#3,#4){\draw (#1,#2) -- (#3,#4);}
\def\Arrow(#1,#2,#3,#4){\draw[->] (#1,#2) -- (#3,#4);}
\def\Rect(#1,#2,#3,#4){\draw (#1,#2) rectangle (#3,#4);}
\def\FilledRect(#1,#2,#3,#4){\fill (#1,#2) rectangle (#3,#4);}
\def\Axis(#1,#2,#3,#4){
\draw[->] (#1,0) -- (#2,0) node[right] {$x$};
\draw[->] (0,#3) -- (0,#4) node[above] {$y$};
}
\def\AxisNamed(#1,#2,#3,#4,#5,#6){
\draw[->] (#1,0) -- (#2,0) node[right] {#5};
\draw[->] (0,#3) -- (0,#4) node[above] {#6};
}

% ---------- Simple text helpers ----------
\def\Text(#1,#2,#3){\node at (#1,#2) {#3};}
\def\SmallText(#1,#2,#3){\node[font=\small] at (#1,#2) {#3};}
\def\TinyText(#1,#2,#3){\node[font=\tiny] at (#1,#2) {#3};}

% ---------- Simple logic gates ----------
\def\ANDgate(#1,#2,#3){
\node[and gate US, draw, logic gate inputs=nn, anchor=input 1] (#3) at (#1,#2) {};
}

\def\ORgate(#1,#2,#3){
\node[or gate US, draw, logic gate inputs=nn, anchor=input 1] (#3) at (#1,#2) {};
}

\def\NOTgate(#1,#2,#3){
\node[not gate US, draw, anchor=input] (#3) at (#1,#2) {};
}

% ---------- Logic-gate wire helpers ----------
\def\LogicWire(#1,#2){
\draw (#1) -- ++(0.35,0) |- (#2);
}

\def\LogicWireArrow(#1,#2){
\draw[->] (#1) -- ++(0.35,0) |- (#2);
}

\def\LogicWireDirect(#1,#2){
\draw (#1) -- (#2);
}

\def\LogicWireFrom(#1,#2,#3){
\draw (#1,#2) -- ++(0.35,0) |- (#3);
}

\def\LogicWireFromArrow(#1,#2,#3){
\draw[->] (#1,#2) -- ++(0.35,0) |- (#3);
}

\def\LogicWireTo(#1,#2,#3){
\draw (#1) -- ++(0.35,0) |- (#2,#3);
}

\def\LogicWireToArrow(#1,#2,#3){
\draw[->] (#1) -- ++(0.35,0) |- (#2,#3);
}
\def\Triangle(#1,#2,#3,#4,#5,#6){
\draw (#1,#2) -- (#3,#4) -- (#5,#6) -- cycle;
}

\def\FilledTriangle(#1,#2,#3,#4,#5,#6){
\fill (#1,#2) -- (#3,#4) -- (#5,#6) -- cycle;
}
% ---------- More logic gates ----------
\def\BUFFERgate(#1,#2,#3){
\node[buffer gate US, draw, anchor=input] (#3) at (#1,#2) {};
}

\def\NANDgate(#1,#2,#3){
\node[nand gate US, draw, logic gate inputs=nn, anchor=input 1] (#3) at (#1,#2) {};
}

\def\NORgate(#1,#2,#3){
\node[nor gate US, draw, logic gate inputs=nn, anchor=input 1] (#3) at (#1,#2) {};
}

\def\XORgate(#1,#2,#3){
\node[xor gate US, draw, logic gate inputs=nn, anchor=input 1] (#3) at (#1,#2) {};
}

\def\XNORgate(#1,#2,#3){
\node[xnor gate US, draw, logic gate inputs=nn, anchor=input 1] (#3) at (#1,#2) {};
}
`;