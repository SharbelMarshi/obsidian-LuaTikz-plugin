export const SIMPLE_TIKZ_HELPERS = String.raw`
% logic gate scaling
\tikzset{
  every and gate US/.append style={transform shape},
  every or gate US/.append style={transform shape},
  every not gate US/.append style={transform shape},
  every nand gate US/.append style={transform shape},
  every nor gate US/.append style={transform shape},
  every xor gate US/.append style={transform shape},
  every xnor gate US/.append style={transform shape},
  every buffer gate US/.append style={transform shape},
}

% shapes
\def\Circle(#1,#2,#3){\draw (#1,#2) circle (#3);}
\def\FilledCircle(#1,#2,#3){\fill (#1,#2) circle (#3);}
\def\Point(#1,#2){\fill (#1,#2) circle (1.7pt);}
\def\Line(#1,#2,#3,#4){\draw (#1,#2) -- (#3,#4);}
\def\Arrow(#1,#2,#3,#4){\draw[->] (#1,#2) -- (#3,#4);}
\def\DArrow(#1,#2,#3,#4){\draw[<->] (#1,#2) -- (#3,#4);}
\def\DashedLine(#1,#2,#3,#4){\draw[dashed] (#1,#2) -- (#3,#4);}
\def\DottedLine(#1,#2,#3,#4){\draw[dotted] (#1,#2) -- (#3,#4);}
\def\HLine(#1,#2,#3){\draw (#1,#3) -- (#2,#3);}
\def\VLine(#1,#2,#3){\draw (#3,#1) -- (#3,#2);}
\def\Rect(#1,#2,#3,#4){\draw (#1,#2) rectangle (#3,#4);}
\def\FilledRect(#1,#2,#3,#4){\fill (#1,#2) rectangle (#3,#4);}
\def\RoundedRect(#1,#2,#3,#4){\draw[rounded corners] (#1,#2) rectangle (#3,#4);}
\def\FilledRoundedRect(#1,#2,#3,#4){\fill[rounded corners] (#1,#2) rectangle (#3,#4);}
\def\Ellipse(#1,#2,#3,#4){\draw (#1,#2) ellipse (#3 and #4);}
\def\FilledEllipse(#1,#2,#3,#4){\fill (#1,#2) ellipse (#3 and #4);}
\def\Cross(#1,#2,#3){
\draw (#1-#3,#2) -- (#1+#3,#2);
\draw (#1,#2-#3) -- (#1,#2+#3);
}
\def\Diamond(#1,#2,#3,#4){
\draw (#1,#2+#4) -- (#1+#3,#2) -- (#1,#2-#4) -- (#1-#3,#2) -- cycle;
}
\def\FilledDiamond(#1,#2,#3,#4){
\fill (#1,#2+#4) -- (#1+#3,#2) -- (#1,#2-#4) -- (#1-#3,#2) -- cycle;
}
\def\Arc(#1,#2,#3,#4,#5){\draw (#1,#2) arc (#4:#5:#3);}
\def\RightAngle(#1,#2,#3){
\draw (#1,#2+#3) -- (#1,#2) -- (#1+#3,#2);
}
\def\Grid(#1,#2,#3,#4,#5){
\draw[step=#5] (#1,#2) grid (#3,#4);
}
\def\Axis(#1,#2,#3,#4){
\draw[->] (#1,0) -- (#2,0) node[right] {$x$};
\draw[->] (0,#3) -- (0,#4) node[above] {$y$};
}
\def\AxisNamed(#1,#2,#3,#4,#5,#6){
\draw[->] (#1,0) -- (#2,0) node[right] {#5};
\draw[->] (0,#3) -- (0,#4) node[above] {#6};
}

% text
\def\Text(#1,#2,#3){\node[transform shape] at (#1,#2) {#3};}
\def\SmallText(#1,#2,#3){\node[font=\small, transform shape] at (#1,#2) {#3};}
\def\TinyText(#1,#2,#3){\node[font=\tiny, transform shape] at (#1,#2) {#3};}
\def\TextAbove(#1,#2,#3){\node[above, transform shape] at (#1,#2) {#3};}
\def\TextBelow(#1,#2,#3){\node[below, transform shape] at (#1,#2) {#3};}
\def\TextLeft(#1,#2,#3){\node[left, transform shape] at (#1,#2) {#3};}
\def\TextRight(#1,#2,#3){\node[right, transform shape] at (#1,#2) {#3};}

% gates
\def\ANDgate(#1,#2,#3){
\node[and gate US, draw, logic gate inputs=nn, anchor=input 1, transform shape] (#3) at (#1,#2) {};
}

\def\ORgate(#1,#2,#3){
\node[or gate US, draw, logic gate inputs=nn, anchor=input 1, transform shape] (#3) at (#1,#2) {};
}

\def\NOTgate(#1,#2,#3){
\node[not gate US, draw, anchor=input, transform shape] (#3) at (#1,#2) {};
}

\def\BUFFERgate(#1,#2,#3){
\node[buffer gate US, draw, anchor=input, transform shape] (#3) at (#1,#2) {};
}

\def\NANDgate(#1,#2,#3){
\node[nand gate US, draw, logic gate inputs=nn, anchor=input 1, transform shape] (#3) at (#1,#2) {};
}

\def\NORgate(#1,#2,#3){
\node[nor gate US, draw, logic gate inputs=nn, anchor=input 1, transform shape] (#3) at (#1,#2) {};
}

\def\XORgate(#1,#2,#3){
\node[xor gate US, draw, logic gate inputs=nn, anchor=input 1, transform shape] (#3) at (#1,#2) {};
}

\def\XNORgate(#1,#2,#3){
\node[xnor gate US, draw, logic gate inputs=nn, anchor=input 1, transform shape] (#3) at (#1,#2) {};
}

% wires
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

% circuit symbols
\def\Resistor(#1,#2,#3,#4){
\draw (#1,#2) -- ++(0.15,0);
\draw (#1+0.15,#2-#4/2) rectangle ++(#3-0.3,#4);
\draw (#1+#3-0.15,#2) -- ++(0.15,0);
}

\def\Capacitor(#1,#2,#3,#4){
\draw (#1,#2) -- ++(0.15,0);
\draw (#1+0.15,#2-#4) -- (#1+0.15,#2+#4);
\draw (#1+0.15+#3,#2-#4) -- (#1+0.15+#3,#2+#4);
\draw (#1+0.15+#3,#2) -- ++(0.15,0);
}

\def\Ground(#1,#2,#3){
\draw (#1,#2) -- (#1,#2-#3);
\draw (#1-0.25,#2-#3) -- (#1+0.25,#2-#3);
\draw (#1-0.15,#2-#3-0.12) -- (#1+0.15,#2-#3-0.12);
\draw (#1-0.08,#2-#3-0.24) -- (#1+0.08,#2-#3-0.24);
}

\def\VSource(#1,#2,#3,#4){
\draw (#1,#2) circle (#3);
\node[transform shape] at (#1,#2) {$#4$};
}
`;
