#!/usr/bin/env python3
"""Generate the README diagrams (light + dark HTML) from one geometry source.

Skin: slate + amber with Inter + JetBrains Mono, taken from site/index.html
(diagram-design skill profile "oraplanviz").

    python3 docs/diagrams/build_diagrams.py docs/diagrams

Then export each HTML to a 2x PNG with the diagram-design skill's
scripts/export_png.py (needs Playwright), e.g.
    python3 <skill>/scripts/export_png.py docs/diagrams/ways-in.html docs/diagrams/ways-in.png 2
README.md shows the PNGs through <picture>, light and dark.
"""
import math
import sys
from pathlib import Path

SKINS = {
    'light': dict(
        paper='#f8fafc', paper2='#f1f5f9', ink='#0f172a', ink_rgb=(15, 23, 42),
        muted='#475569', muted_rgb=(71, 85, 105), soft='#5a6a7f',
        accent='#b45309', accent_rgb=(180, 83, 9), accent_tint=0.08,
        link='#2563eb', backend_fill='#ffffff',
    ),
    'dark': dict(
        paper='#0f172a', paper2='#1e293b', ink='#f1f5f9', ink_rgb=(241, 245, 249),
        muted='#94a3b8', muted_rgb=(148, 163, 184), soft='#8392a8',
        accent='#fbbf24', accent_rgb=(251, 191, 36), accent_tint=0.10,
        link='#60a5fa', backend_fill='#1e293b',
    ),
}

SANS = "'Inter', system-ui, sans-serif"
MONO = "'JetBrains Mono', ui-monospace, monospace"
SERIF = "'Instrument Serif', serif"
FONT_LINK = ('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1'
             '&amp;family=Inter:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap')


def rgba(rgb, a):
    return f'rgba({rgb[0]},{rgb[1]},{rgb[2]},{a})'


def ceil4(v):
    return int(math.ceil(v / 4.0) * 4)


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


class Svg:
    def __init__(self, s):
        self.s = s
        self.parts = []

    def add(self, x):
        self.parts.append(x)

    # ---- primitives -------------------------------------------------------
    def line(self, x1, y1, x2, y2, kind='muted', dashed=False):
        s = self.s
        color = {'muted': s['muted'], 'accent': s['accent'], 'link': s['link']}[kind]
        marker = {'muted': 'arrow', 'accent': 'arrow-accent', 'link': 'arrow-link'}[kind]
        width = '1.4' if kind == 'accent' else ('1' if dashed else '1.2')
        dash = ' stroke-dasharray="5,4"' if dashed else ''
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
                 f'stroke-width="{width}"{dash} marker-end="url(#{marker})"/>')

    def path(self, d, kind='muted', dashed=False):
        s = self.s
        color = {'muted': s['muted'], 'accent': s['accent'], 'link': s['link']}[kind]
        marker = {'muted': 'arrow', 'accent': 'arrow-accent', 'link': 'arrow-link'}[kind]
        width = '1.4' if kind == 'accent' else ('1' if dashed else '1.2')
        dash = ' stroke-dasharray="5,4"' if dashed else ''
        self.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dash} '
                 f'marker-end="url(#{marker})"/>')

    def label_w(self, text):
        # JetBrains Mono 8px: 0.62em advance + 0.06em tracking, plus 6px padding a side
        return ceil4(len(text) * (8 * 0.62 + 8 * 0.06) + 12)

    def zone_paper(self):
        """paper composited with the zone's ink @ 0.02 wash, for masks inside a zone."""
        s = self.s
        p = [int(s['paper'][i:i + 2], 16) for i in (1, 3, 5)]
        c = [round(pp * 0.98 + ii * 0.02) for pp, ii in zip(p, s['ink_rgb'])]
        return '#%02x%02x%02x' % tuple(c)

    def label(self, cx, y_line, text, kind='muted', side='above', x_left=None, in_zone=False):
        """Arrow label on an opaque mask with an 8px gap from the stroke."""
        s = self.s
        mask = self.zone_paper() if in_zone else s['paper']
        color = {'muted': s['soft'], 'accent': s['accent'], 'link': s['link']}[kind]
        w = self.label_w(text)
        if side == 'above':
            my = y_line - 8 - 12
        elif side == 'below':
            my = y_line + 8
        elif side == 'beside':
            my = y_line - 6
        else:
            raise ValueError(side)
        if x_left is not None:
            mx = x_left
            tx = mx + w / 2
        else:
            mx = cx - w / 2
            tx = cx
        self.add(f'<rect x="{mx:g}" y="{my}" width="{w}" height="12" rx="2" fill="{mask}"/>')
        self.add(f'<text x="{tx:g}" y="{my + 9}" fill="{color}" font-size="8" font-family="{MONO}" '
                 f'text-anchor="middle" letter-spacing="0.06em">{esc(text)}</text>')

    def node(self, x, y, w, h, kind, name, subs=(), tag=None, name_y=None, sub_gap=16, sub_step=14):
        s = self.s
        ink_rgb, mut = s['ink_rgb'], s['muted_rgb']
        dash = ''
        if kind == 'focal':
            fill, stroke = rgba(s['accent_rgb'], s['accent_tint']), s['accent']
            tag_stroke, tag_text = rgba(s['accent_rgb'], 0.5), s['accent']
        elif kind == 'backend':
            fill, stroke = s['backend_fill'], s['ink']
            tag_stroke, tag_text = rgba(ink_rgb, 0.4), s['ink']
        elif kind == 'store':
            fill, stroke = rgba(ink_rgb, 0.05), s['muted']
            tag_stroke, tag_text = rgba(mut, 0.5), s['muted']
        elif kind == 'input':
            fill, stroke = rgba(mut, 0.10), s['soft']
            tag_stroke, tag_text = rgba(mut, 0.4), s['soft']
        elif kind == 'optional':
            fill, stroke = rgba(ink_rgb, 0.02), rgba(ink_rgb, 0.40)
            tag_stroke, tag_text = rgba(ink_rgb, 0.3), s['soft']
            dash = ' stroke-dasharray="4,3"'
        elif kind == 'actor':
            fill, stroke = s['backend_fill'], rgba(ink_rgb, 0.45)
            tag_stroke, tag_text = rgba(ink_rgb, 0.3), s['soft']
        else:
            raise ValueError(kind)
        cx = x + w / 2
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{s["paper"]}"/>')
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" '
                 f'stroke-width="1"{dash}/>')
        if tag:
            tw = ceil4(len(tag) * 7 * 0.62 + len(tag) * 7 * 0.08 + 10)
            self.add(f'<rect x="{x + 8}" y="{y + 8}" width="{tw}" height="12" rx="2" fill="none" '
                     f'stroke="{tag_stroke}" stroke-width="0.8"/>')
            self.add(f'<text x="{x + 8 + tw / 2:g}" y="{y + 17}" fill="{tag_text}" font-size="7" '
                     f'font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{esc(tag)}</text>')
        if name_y is None:
            block = 12 + (sub_gap + (len(subs) - 1) * sub_step if subs else 0)
            name_y = y + h / 2 - block / 2 + 10
        self.add(f'<text x="{cx:g}" y="{name_y:g}" fill="{s["ink"]}" font-size="12" font-weight="600" '
                 f'font-family="{SANS}" text-anchor="middle">{esc(name)}</text>')
        for i, sub in enumerate(subs):
            sy = name_y + sub_gap + i * sub_step
            self.add(f'<text x="{cx:g}" y="{sy:g}" fill="{s["muted"]}" font-size="9" font-family="{MONO}" '
                     f'text-anchor="middle">{esc(sub)}</text>')

    def zone(self, x, y, w, h, label):
        s = self.s
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{rgba(s["ink_rgb"], 0.02)}" '
                 f'stroke="{rgba(s["ink_rgb"], 0.18)}" stroke-width="0.8" stroke-dasharray="4,4"/>')
        lw = ceil4(len(label) * 7 * (0.62 + 0.14) + 12)
        self.add(f'<rect x="{x + 16}" y="{y - 6}" width="{lw}" height="12" rx="2" fill="{s["paper"]}"/>')
        self.add(f'<text x="{x + 16 + lw / 2:g}" y="{y + 3}" fill="{s["soft"]}" font-size="7" '
                 f'font-family="{MONO}" text-anchor="middle" letter-spacing="0.14em">{esc(label)}</text>')

    def lifeline(self, x, y1, y2):
        self.add(f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="{rgba(self.s["ink_rgb"], 0.25)}" '
                 f'stroke-width="1" stroke-dasharray="3,3"/>')

    def activation(self, x, y1, y2):
        self.add(f'<rect x="{x - 4}" y="{y1}" width="8" height="{y2 - y1}" fill="{rgba(self.s["ink_rgb"], 0.06)}" '
                 f'stroke="{self.s["muted"]}" stroke-width="0.8"/>')

    # ---- legend -----------------------------------------------------------
    def legend(self, y, width, items):
        s = self.s
        self.add(f'<line x1="40" y1="{y}" x2="{width - 40}" y2="{y}" stroke="{rgba(s["ink_rgb"], 0.10)}" stroke-width="0.8"/>')
        self.add(f'<text x="40" y="{y + 16}" fill="{s["muted"]}" font-size="8" font-family="{MONO}" '
                 f'letter-spacing="0.18em">LEGEND</text>')
        x = 40
        iy = y + 32
        for kind, text in items:
            if kind.startswith('arrow-'):
                k = kind[len('arrow-'):]
                dashed = k.endswith('-dashed')
                k = k.replace('-dashed', '')
                self.line(x, iy + 5, x + 28, iy + 5, k, dashed)
                tx = x + 36
            else:
                self.legend_swatch(x, iy, kind)
                tx = x + 20
            self.add(f'<text x="{tx}" y="{iy + 8}" fill="{s["muted"]}" font-size="9" font-family="{SANS}">{esc(text)}</text>')
            x = tx + ceil4(len(text) * 9 * 0.56) + 28

    def legend_swatch(self, x, y, kind):
        s = self.s
        ink_rgb, mut = s['ink_rgb'], s['muted_rgb']
        dash = ''
        if kind == 'focal':
            fill, stroke = rgba(s['accent_rgb'], s['accent_tint']), s['accent']
        elif kind == 'backend':
            fill, stroke = s['backend_fill'], s['ink']
        elif kind == 'store':
            fill, stroke = rgba(ink_rgb, 0.05), s['muted']
        elif kind == 'input':
            fill, stroke = rgba(mut, 0.10), s['soft']
        elif kind == 'optional':
            fill, stroke = rgba(ink_rgb, 0.02), rgba(ink_rgb, 0.40)
            dash = ' stroke-dasharray="3,2"'
        else:
            raise ValueError(kind)
        self.add(f'<rect x="{x}" y="{y}" width="14" height="10" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="1"{dash}/>')


# ---------------------------------------------------------------------------
# Diagram 1: four ways to get a plan into the app
# ---------------------------------------------------------------------------
def ways_in(svg):
    W, H = 960, 456
    rows = [40, 128, 216, 304]          # route node tops, h=64, gap 24
    centers = [r + 32 for r in rows]    # 72, 160, 248, 336
    # Arrows first
    left_labels = ['SQL*PLUS', 'SQL*PLUS', 'ANY CLIENT', 'ORACLE NET']
    right_labels = ['CLICK THE URL', 'PASTE OR DROP', 'PASTE OR DROP', 'LOCAL HTTP']
    for i, cy in enumerate(centers):
        optional = i == 3
        svg.line(200, cy, 360, cy, 'muted', dashed=optional)
        kind = 'accent' if i == 0 else 'muted'
        svg.line(600, cy, 760, cy, kind, dashed=optional)
    for i, cy in enumerate(centers):
        svg.label(280, cy, left_labels[i])
        svg.label(680, cy, right_labels[i], 'accent' if i == 0 else 'muted')
    # Nodes
    svg.node(40, 40, 160, 328, 'store', 'Oracle Database',
             ['cursor cache', 'SQL Monitor', 'AWR'], tag='DB')
    routes = [
        ('focal', 'URL', 'plan_to_url.sql', 'prints a link with the plan inside'),
        ('backend', 'JSON', 'plan_to_json.sql', 'plan + schema metadata in one paste'),
        ('input', 'TEXT', 'DBMS_XPLAN · SQL Monitor', 'or V$SQL_PLAN as CSV / JSON'),
        ('optional', 'OPT', 'DB connector', 'local Python, self-hosted build'),
    ]
    for (kind, tag, name, sub), top in zip(routes, rows):
        svg.node(360, top, 240, 64, kind, name, [sub], tag=tag, name_y=top + 36)
    svg.node(760, 40, 160, 328, 'backend', 'Plan Visualizer',
             ['parses and draws', 'in your browser'], tag='APP')
    svg.legend(392, W, [
        ('focal', 'Fastest: one click'),
        ('backend', 'Script / app'),
        ('store', 'Database'),
        ('input', 'Copy by hand'),
        ('optional', 'Optional'),
        ('arrow-muted-dashed', 'Self-hosted only'),
    ])
    return W, H


# ---------------------------------------------------------------------------
# Diagram 2: plan_to_url.sql at a glance (run, link, plan)
# ---------------------------------------------------------------------------
def plan_to_url(svg):
    W, H = 960, 168
    # arrows first
    svg.line(320, 84, 384, 84, 'muted')
    svg.line(624, 84, 688, 84, 'accent')
    svg.label(352, 84, 'PRINTS')
    svg.label(656, 84, 'CLICK', 'accent')
    # nodes
    svg.node(40, 40, 280, 88, 'backend', 'Run one script',
             ['@plan_to_url.sql <sql_id>'], tag='SQL*PLUS')
    svg.node(384, 40, 240, 88, 'focal', 'Get a link',
             ['https://…/#gz=H4sIAAAAAAACA81d…'], tag='URL')
    svg.node(688, 40, 232, 88, 'backend', 'See the plan',
             ['drawn in your browser'], tag='APP')
    return W, H


# ---------------------------------------------------------------------------
# Diagram 3: the optional DB connector
# ---------------------------------------------------------------------------
def db_connector(svg):
    W, H = 960, 296
    svg.zone(40, 48, 616, 152, 'YOUR MACHINE')
    # arrows
    svg.line(272, 124, 408, 124, 'link')
    svg.line(608, 124, 760, 124, 'muted')
    svg.label(340, 124, 'HTTP + TOKEN', 'link', in_zone=True)
    svg.label(708, 124, 'ORACLE NET')
    # nodes
    svg.node(72, 84, 200, 80, 'backend', 'Plan Visualizer',
             ['self-hosted build', 'VITE_ENABLE_DB_AGENT=1'], tag='APP')
    svg.node(408, 84, 200, 80, 'focal', 'oraplanviz-agent',
             ['127.0.0.1:8521', 'python-oracledb, thin mode'], tag='PY')
    svg.node(760, 84, 160, 80, 'store', 'Oracle Database',
             ['host:1521/service'], tag='DB')
    svg.legend(228, W, [
        ('focal', 'Connector'),
        ('backend', 'App'),
        ('store', 'Database'),
        ('arrow-link', 'Localhost HTTP, bearer token'),
        ('arrow-muted', 'Oracle Net'),
    ])
    return W, H


DIAGRAMS = {
    'ways-in': dict(fn=ways_in, eyebrow='Architecture',
                    title='Four ways to get a plan into the app',
                    desc='Architecture diagram showing an Oracle database feeding the Plan Visualizer through '
                         'plan_to_url.sql (a link), plan_to_json.sql (plan plus metadata), copied DBMS_XPLAN or '
                         'SQL Monitor output, and the optional local DB connector.'),
    'plan-to-url': dict(fn=plan_to_url, eyebrow='Process',
                        title='plan_to_url.sql in three steps',
                        desc='Process diagram: run plan_to_url.sql with a sql_id, it prints a link carrying the '
                             'compressed plan, and clicking the link draws the plan in your browser.'),
    'db-connector': dict(fn=db_connector, eyebrow='Architecture',
                         title='The optional DB connector',
                         desc='Architecture diagram showing the Plan Visualizer talking to the local '
                              'oraplanviz-agent connector over localhost HTTP with a bearer token, and the '
                              'connector reaching the Oracle database over Oracle Net in thin mode.'),
}


def render(slug, variant):
    s = SKINS[variant]
    meta = DIAGRAMS[slug]
    svg = Svg(s)
    W, H = meta['fn'](svg)
    sid = slug if variant == 'light' else f'{slug}-dark'
    defs = ''.join(
        f'<marker id="{mid}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">'
        f'<polygon points="0 0, 8 3, 0 6" fill="{col}"/></marker>'
        for mid, col in (('arrow', s['muted']), ('arrow-accent', s['accent']), ('arrow-link', s['link'])))
    body = '\n        '.join(svg.parts)
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(meta['title'])}</title>
  <link href="{FONT_LINK}" rel="stylesheet">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{
      --color-paper:  {s['paper']};
      --color-ink:    {s['ink']};
      --color-muted:  {s['muted']};
      --color-accent: {s['accent']};
      --font-sans:    {SANS};
      --font-serif:   {SERIF};
      --font-mono:    {MONO};
    }}
    body {{
      font-family: var(--font-sans);
      background: var(--color-paper);
      color: var(--color-ink);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
    }}
    .frame {{ max-width: 1200px; width: 100%; }}
    .diagram-container {{ width: 100%; overflow-x: auto; }}
    .eyebrow {{
      font-family: var(--font-mono);
      font-size: 0.66rem;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--color-muted);
      margin-bottom: 0.5rem;
    }}
    h1 {{
      font-family: var(--font-serif);
      font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem);
      font-weight: 400;
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: var(--color-ink);
      margin-bottom: 1.5rem;
    }}
    svg {{ width: 100%; min-width: {W}px; display: block; }}
    @media print {{
      .diagram-container {{ overflow-x: visible; }}
      svg {{ min-width: 0; }}
    }}
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">{esc(meta['eyebrow'])} · ora-explain-plan-viz</p>
    <h1>{esc(meta['title'])}</h1>
    <div class="diagram-container">
      <svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{sid}-title {sid}-desc">
        <title id="{sid}-title">{esc(meta['title'])}</title>
        <desc id="{sid}-desc">{esc(meta['desc'])}</desc>
        <defs>{defs}</defs>
        <rect width="100%" height="100%" fill="{s['paper']}"/>
        {body}
      </svg>
    </div>
  </div>
</body>
</html>
'''


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for slug in DIAGRAMS:
        for variant in ('light', 'dark'):
            name = f'{slug}.html' if variant == 'light' else f'{slug}-dark.html'
            (out / name).write_text(render(slug, variant))
            print(out / name)


if __name__ == '__main__':
    main()
