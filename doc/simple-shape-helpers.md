# Simple shape helpers

The plugin injects TikZ macros from `simpleShapes.ts` into every compile. Use them inside `\begin{tikzpicture}...\end{tikzpicture}` without defining them yourself.

**Syntax:** `\MacroName(arg1,arg2,...)` — comma-separated numeric or text arguments.

> **Note:** Arguments cannot contain commas. For complex labels, use standard `\node` instead of `\Text`.

---

## Drawing primitives

| Macro | Arguments | Description |
|-------|-----------|-------------|
| `\Circle(x,y,r)` | center, radius | Circle outline |
| `\FilledCircle(x,y,r)` | center, radius | Filled circle |
| `\Point(x,y)` | position | Small dot (fixed 1.7pt size) |
| `\Line(x1,y1,x2,y2)` | endpoints | Line segment |
| `\Arrow(x1,y1,x2,y2)` | endpoints | Arrow (`->`) |
| `\DArrow(x1,y1,x2,y2)` | endpoints | Double arrow (`<->`) |
| `\DashedLine(x1,y1,x2,y2)` | endpoints | Dashed line |
| `\DottedLine(x1,y1,x2,y2)` | endpoints | Dotted line |
| `\HLine(x1,x2,y)` | x range, y | Horizontal line |
| `\VLine(y1,y2,x)` | y range, x | Vertical line |

## Rectangles & polygons

| Macro | Arguments | Description |
|-------|-----------|-------------|
| `\Rect(x1,y1,x2,y2)` | corners | Rectangle outline |
| `\FilledRect(x1,y1,x2,y2)` | corners | Filled rectangle |
| `\RoundedRect(x1,y1,x2,y2)` | corners | Rounded rectangle |
| `\FilledRoundedRect(x1,y1,x2,y2)` | corners | Filled rounded rectangle |
| `\Triangle(x1,y1,x2,y2,x3,y3)` | three vertices | Triangle outline |
| `\FilledTriangle(...)` | three vertices | Filled triangle |
| `\Ellipse(x,y,rx,ry)` | center, radii | Ellipse outline |
| `\FilledEllipse(x,y,rx,ry)` | center, radii | Filled ellipse |
| `\Diamond(x,y,w,h)` | center, half-width, half-height | Diamond outline |
| `\FilledDiamond(x,y,w,h)` | center, half-width, half-height | Filled diamond |

## Marks & annotations

| Macro | Arguments | Description |
|-------|-----------|-------------|
| `\Cross(x,y,size)` | center, half-size | Plus/cross marker |
| `\Arc(x,y,r,start,end)` | center, radius, angles (°) | Circular arc |
| `\RightAngle(x,y,size)` | corner, leg length | Right-angle mark |
| `\Grid(x1,y1,x2,y2,step)` | bounds, step | Grid lines |

## Axes

| Macro | Arguments | Description |
|-------|-----------|-------------|
| `\Axis(xmin,xmax,ymin,ymax)` | axis ranges | XY axes labeled $x$, $y$ |
| `\AxisNamed(xmin,xmax,ymin,ymax,xlabel,ylabel)` | ranges + labels | Named axes |

Example:

```tikz
\begin{tikzpicture}
\AxisNamed(-1,4,-1,3,t,signal)
\end{tikzpicture}
```

## Text helpers

All text helpers use `transform shape` so labels scale with `[scale=...]`.

| Macro | Arguments | Description |
|-------|-----------|-------------|
| `\Text(x,y,label)` | position, text | Plain node |
| `\SmallText(x,y,label)` | position, text | `\small` font |
| `\TinyText(x,y,label)` | position, text | `\tiny` font |
| `\TextAbove(x,y,label)` | position, text | Node above point |
| `\TextBelow(x,y,label)` | position, text | Node below point |
| `\TextLeft(x,y,label)` | position, text | Node to the left |
| `\TextRight(x,y,label)` | position, text | Node to the right |

For Hebrew labels use `\Text(0,0,\he{שלום})` — see [RTL, English & math](rtl-and-math.md).

## Logic gates

Gates are named nodes you can wire to. **Third argument is the node name** (used by wire helpers).

| Macro | Arguments | Gate |
|-------|-----------|------|
| `\ANDgate(x,y,name)` | position, name | AND |
| `\ORgate(x,y,name)` | position, name | OR |
| `\NOTgate(x,y,name)` | position, name | NOT |
| `\NANDgate(x,y,name)` | position, name | NAND |
| `\NORgate(x,y,name)` | position, name | NOR |
| `\XORgate(x,y,name)` | position, name | XOR |
| `\XNORgate(x,y,name)` | position, name | XNOR |
| `\BUFFERgate(x,y,name)` | position, name | Buffer |

Example:

```tikz
\begin{tikzpicture}
\ANDgate(0,0,and1)
\NOTgate(3,0,not1)
\LogicWire(and1.output, not1.input)
\end{tikzpicture}
```

Gates scale correctly with `[scale=...]` — see [Scaling diagrams](scaling.md).

## Logic wire helpers

| Macro | Description |
|-------|-------------|
| `\LogicWire(a,b)` | Orthogonal wire between named nodes |
| `\LogicWireArrow(a,b)` | Same, with arrowhead |
| `\LogicWireDirect(a,b)` | Straight wire |
| `\LogicWireFrom(x,y,node)` | From coordinate to node |
| `\LogicWireFromArrow(x,y,node)` | From coordinate to node (arrow) |
| `\LogicWireTo(node,x,y)` | From node to coordinate |
| `\LogicWireToArrow(node,x,y)` | From node to coordinate (arrow) |

Use anchor names like `and1.input 1`, `and1.output`, `not1.input`.

## Circuit symbols

| Macro | Arguments | Description |
|-------|-----------|-------------|
| `\Resistor(x,y,width,height)` | start, size | Box-style resistor |
| `\Capacitor(x,y,gap,height)` | start, plate gap, plate height | Capacitor symbol |
| `\Ground(x,y,length)` | top point, stem length | Ground symbol |
| `\VSource(x,y,r,label)` | center, radius, label | Circle with math label |

Example:

```tikz
\begin{tikzpicture}
\Resistor(0,0,1,0.3)
\Capacitor(1.5,0,0.2,0.3)
\Ground(3,0,0.4)
\end{tikzpicture}
```

## Full example

```tikz
\begin{tikzpicture}[scale=0.8, transform shape]
\Axis(-1,5,-1,3)
\FilledCircle(1,1,0.5)
\Arrow(1,1,3,2)
\ANDgate(4,1,g1)
\TextBelow(4,0.2,{AND gate})
\end{tikzpicture}
```
