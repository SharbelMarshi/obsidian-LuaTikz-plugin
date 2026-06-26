

קובץ זה מסביר איך לכתוב בלוקי `tikz` שעובדים עם התוסף המקומי שמריץ `LuaLaTeX` בתוך Obsidian, תומך בעברית, באנגלית ובנוסחאות, ומציג את התוצאה כ־PNG כדי למנוע שיבושי פונטים ושברים.

## עיקרון עבודה

בתוך Obsidian כותבים רק את גוף השרטוט:

```tikz
\begin{tikzpicture}
...
\end{tikzpicture}
```

אין צורך לכתוב בתוך הבלוק:

```latex
\documentclass{...}
\usepackage{...}
\begin{document}
\end{document}
```

התוסף מוסיף את ה־preamble לבד.

## תבנית בסיסית

```tikz
\begin{tikzpicture}
\node at (0,0) {Hello};
\node at (0,-1) {\he{שלום עולם}};
\node at (0,-2) {$V_G=\frac{Q}{C}$};
\end{tikzpicture}
```

## עברית

לטקסט בעברית מומלץ להשתמש תמיד בפקודה:

```latex
\he{טקסט בעברית}
```

לדוגמה:

```tikz
\begin{tikzpicture}
\node[draw, minimum width=4cm, minimum height=1cm] at (0,0) {\he{קבל MOS}};
\node at (0,-1.2) {\he{מוליך למחצה}};
\end{tikzpicture}
```

הסיבה: הפקודה `\he{...}` מכריחה את LuaLaTeX להתייחס לטקסט כעברית, בלי לבלבל אותו עם אנגלית או נוסחאות.

## אנגלית

אנגלית כותבים רגיל:

```tikz
\begin{tikzpicture}
\node at (0,0) {Source};
\node at (2,0) {Encoder};
\draw[->] (0.7,0) -- (1.3,0);
\end{tikzpicture}
```

אם רוצים טקסט באנגלית בתוך מצב מתמטי, משתמשים ב־`\text{...}`:

```tikz
\begin{tikzpicture}
\node at (0,0) {$\text{Source Encoder}$};
\end{tikzpicture}
```

## נוסחאות

נוסחאות כותבים כרגיל בתוך `$...$`:

```tikz
\begin{tikzpicture}
\node at (0,0) {$C=\frac{\varepsilon A}{d}$};
\node at (0,-1) {$V_G=\frac{Q}{C}$};
\node at (0,-2) {$E=\frac{V}{d}$};
\end{tikzpicture}
```

התוסף מציג את הפלט כ־PNG, ולכן גם `\frac`, אותיות מתמטיות, עברית ואנגלית אמורים להופיע נכון.

## חשוב: כל פקודת TikZ מסתיימת בנקודה־פסיק

ב־TikZ חייבים לסיים כמעט כל פקודה ב־`;`.

נכון:

```tikz
\begin{tikzpicture}
\node at (0,0) {jajaja};
\node at (1,1) {$b=\frac{1}{3}$};
\end{tikzpicture}
```

לא נכון:

```latex
\node at (0,0) {jajaja}
\node at (1,1) {$b=\frac{1}{3}$}
```

אם חסר `;`, תופיע שגיאה בסגנון:

```text
Package tikz Error: Giving up on this path. Did you forget a semicolon?
```

## תבנית לתרשים בלוקים בעברית

```tikz
\begin{tikzpicture}[
  block/.style={draw, minimum width=3.2cm, minimum height=1cm, align=center},
  arrow/.style={->, thick}
]

\node[block] (src) at (0,0) {\he{מקור מידע}};
\node[block] (enc) at (4,0) {\he{מקודד מקור}};
\node[block] (ch)  at (8,0) {\he{ערוץ}};

\draw[arrow] (src) -- (enc);
\draw[arrow] (enc) -- (ch);

\node at (2,0.45) {$x[n]$};
\node at (6,0.45) {$b_k$};

\end{tikzpicture}
```

## תבנית לעץ קידוד

```tikz
\begin{tikzpicture}[
  scale=0.82,
  transform shape,
  x=1cm,
  y=1cm,
  every node/.style={font=\small},
  edge label/.style={midway, fill=white, inner sep=1pt}
]

\node (p1) at (0,  2.25) {$p_1$};
\node (p2) at (0,  0.75) {$p_2$};
\node (p3) at (0, -0.75) {$p_3$};
\node (p4) at (0, -2.25) {$p_4$};

\node (n12)  at (2.0,  1.5) {};
\node (n34)  at (2.0, -1.5) {};
\node (root) at (4.3,  0.0) {};

\draw (n12) -- (p1) node[edge label, above] {$1$};
\draw (n12) -- (p2) node[edge label, below] {$0$};

\draw (n34) -- (p3) node[edge label, above] {$1$};
\draw (n34) -- (p4) node[edge label, below] {$0$};

\draw (root) -- (n12) node[edge label, above] {$1$};
\draw (root) -- (n34) node[edge label, below] {$0$};

\node[right=1.0cm] at (6,0.5) {
\large
\renewcommand{\arraystretch}{1.25}
\begin{tabular}{c|c|c}
Symbol & Code & Length\\
\hline
$p_1$ & $11$ & $2$\\
$p_2$ & $10$ & $2$\\
$p_3$ & $01$ & $2$\\
$p_4$ & $00$ & $2$
\end{tabular}
};

\node at (2.0, -2.85) {$p_3+p_4=p_1$};

\end{tikzpicture}
```

## תבנית לטבלה בתוך TikZ

עדיף להשתמש ב־`tabular` ולא ליישר עמודות עם `\quad`.

מומלץ:

```tikz
\begin{tikzpicture}
\node at (0,0) {
\renewcommand{\arraystretch}{1.25}
\begin{tabular}{c|c|c}
Symbol & Code & Length\\
\hline
$a$ & $1$ & $1$\\
$b$ & $01$ & $2$\\
$c$ & $001$ & $3$\\
$d$ & $000$ & $3$
\end{tabular}
};
\end{tikzpicture}
```

פחות מומלץ:

```latex
Symbol\quad Code\quad Length
```

כי `\quad` לא יוצר יישור טבלאי אמיתי.

## תבנית לערבוב עברית ונוסחאות

```tikz
\begin{tikzpicture}
\node[draw, align=center] at (0,0) {
\he{מתח השער}\\
$V_G=\frac{Q}{C}$
};

\node[draw, align=center] at (0,-2) {
\he{קיבול התחמוצת}\\
$C_{ox}=\frac{\varepsilon_{ox}A}{t_{ox}}$
};
\end{tikzpicture}
```

## שינוי גודל

אפשר לשלוט בגודל מתוך ה־TikZ עצמו:

```latex
\begin{tikzpicture}[scale=0.8, transform shape]
```

או:

```latex
\begin{tikzpicture}[scale=1.2, transform shape]
```

כאשר משתמשים ב־`transform shape`, גם הטקסט משתנה יחד עם הציור.

אם רוצים להגדיל רק את הציור בלי הטקסט, אפשר להסיר `transform shape`.

## תבנית מומלצת לשרטוטים גדולים

```tikz
\begin{tikzpicture}[
  scale=0.9,
  transform shape,
  every node/.style={font=\small},
  block/.style={draw, minimum width=3cm, minimum height=1cm, align=center},
  arrow/.style={->, thick}
]

\node[block] (a) at (0,0) {\he{בלוק ראשון}};
\node[block] (b) at (4,0) {\he{בלוק שני}};
\node[block] (c) at (8,0) {\he{בלוק שלישי}};

\draw[arrow] (a) -- (b);
\draw[arrow] (b) -- (c);

\end{tikzpicture}
```

## דברים שכדאי להימנע מהם

לא מומלץ להכניס preamble לבלוק:

```latex
\documentclass{...}
\usepackage{...}
\begin{document}
...
\end{document}
```

לא מומלץ לכתוב עברית בלי `\he{...}` כאשר יש שילוב של עברית, אנגלית ונוסחאות באותו ציור.

לא מומלץ ליישר טבלאות בעזרת הרבה רווחים או `\quad`. עדיף `tabular`.

לא לשכוח `;` בסוף פקודות:

```latex
\node at (0,0) {Text};
\draw (0,0) -- (1,0);
```

## בדיקת תקינות מהירה

אם משהו לא עובד, נסה קודם את הבלוק הזה:

```tikz
\begin{tikzpicture}
\node at (1,2) {$\text{nnjaa}$};
\node at (0,0) {jajaja};
\node at (0,-1) {$b=\frac{1}{3}$};
\node at (0,-2) {$b=1/3$};
\node[draw] at (0,-3) {\he{שלום עולם}};
\end{tikzpicture}
```

אם הבלוק הזה עובד, התוסף תקין והבעיה כנראה בתחביר של הבלוק הספציפי.

## הודעות שגיאה נפוצות

### Did you forget a semicolon?

חסר `;` בסוף פקודת TikZ.

דוגמה בעייתית:

```latex
\node at (0,0) {Text}
\node at (1,0) {More text}
```

תיקון:

```latex
\node at (0,0) {Text};
\node at (1,0) {More text};
```

### LuaLaTeX failed to render

בדרך כלל יש שגיאת LaTeX או TikZ בתוך הבלוק. כדאי לבדוק:
- האם חסר `;`
- האם סוגריים `{}` מאוזנים
- האם יש פקודה שלא קיימת
- האם הכנסת `\usepackage` או `\begin{document}` בתוך הבלוק

### pdftocairo was not found

צריך להתקין Poppler:

```bash
brew install poppler
```

ואז לבדוק:

```bash
which pdftocairo
```

## סיכום קצר

התבנית הבטוחה ביותר:

```tikz
\begin{tikzpicture}
\node at (0,0) {\he{עברית כאן}};
\node at (0,-1) {English here};
\node at (0,-2) {$V_G=\frac{Q}{C}$};
\end{tikzpicture}
```

עברית: `\he{...}`  
אנגלית: רגיל  
נוסחאות: `$...$`  
כל פקודת TikZ: מסתיימת ב־`;`
