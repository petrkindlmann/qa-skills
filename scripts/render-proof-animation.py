#!/usr/bin/env python3
"""Render an eight-second factual explainer. Requires Pillow and ffmpeg.

The 22-fault claim refers to docs/REAL-WORKFLOWS-2026-10-21.md and the
v3.3 addon campaign. This is a motion graphic, not a recording of an agent.
No screenshots, customer data, synthetic testimonials, or generated text.
"""
import argparse
from functools import lru_cache
import json
import math
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

PAPER = '#F6F5F0'
INK = '#191B1D'
MUTED = '#66696B'
LINE = '#DADBD5'
YELLOW = '#F1D655'
RED = '#A63D38'
BLUSH = '#F5E2DD'
WHITE = '#FFFFFF'
DURATION = 8
FPS = 24


@lru_cache(maxsize=96)
def font(size, bold=False, mono=False):
    candidates = ([
        '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
        '/System/Library/Fonts/Menlo.ttc',
    ] if mono else [
        '/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf' if bold else
        '/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
    ])
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, round(size))
    return ImageFont.load_default(size=round(size))


def ease(value):
    value = max(0, min(1, value))
    return 1 - (1 - value) ** 3


def make_frame(t, width, height):
    # Compose in a 1080-wide coordinate system; the widescreen canvas is shorter.
    scale = width / 1080
    h = round(height / scale)
    square = h > 800
    im = Image.new('RGB', (1080, h), PAPER)
    d = ImageDraw.Draw(im)

    def txt(x, y, text, size=24, fill=INK, bold=False, mono=False, anchor='la'):
        d.text((x, y), text, font=font(size, bold, mono), fill=fill, anchor=anchor)

    def rect(box, fill=WHITE, outline=None, radius=14, width=1):
        d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

    def pill(x, y, label, fill=YELLOW, color=INK, size=17):
        f = font(size, True)
        tw = d.textlength(label, font=f)
        rect((x, y, x + tw + 28, y + 33), fill=fill, radius=16)
        txt(x + 14, y + 8, label, size, color, bold=True)

    def check(x, y, color=INK, stroke=3):
        d.line([(x, y + 7), (x + 6, y + 13), (x + 18, y)], fill=color,
               width=stroke, joint='curve')

    margin = 62
    rect((margin, 38, margin + 38, 76), YELLOW, radius=8)
    txt(margin + 19, 46, 'q', 30, bold=True, anchor='ma')
    txt(margin + 52, 46, 'qa skills', 30, bold=True)
    txt(1018, 52, 'THE PROOF LAB', 15, MUTED, bold=True, anchor='ra')
    d.line((margin, 102, 1018, 102), fill=LINE, width=1)

    title_y = 145 if square else 124
    txt(margin, title_y, 'Tests need tests, too.', 68 if square else 54, bold=True)
    subtitles = ['Start with a healthy app.', 'Introduce 22 controlled faults.',
                 'Catch the broken behavior.', 'Keep the evidence.']
    stage = min(3, int(t / 2))
    subtitle_y = title_y + (84 if square else 67)
    txt(margin, subtitle_y, subtitles[stage], 29 if square else 25, MUTED)

    panel_y = 327 if square else 244
    panel_h = 493 if square else 252
    rect((margin, panel_y + 6, 1018, panel_y + panel_h + 6), '#E6E5DF', radius=18)
    rect((margin, panel_y, 1018, panel_y + panel_h), WHITE, LINE, radius=18)
    txt(margin + 26, panel_y + 21, 'CONTROLLED LOCAL FIXTURES', 15, MUTED, bold=True)
    pill(840, panel_y + 14, 'HEALTHY  PASS', fill=INK, color=WHITE, size=14)
    d.line((margin, panel_y + 57, 1018, panel_y + 57), fill=LINE, width=1)

    if stage == 0:
        cx = 540
        cy = panel_y + (200 if square else 126)
        zoom = 0.94 + 0.06 * ease(t / .65)
        rw, rh = 620 * zoom, (190 if square else 92) * zoom
        rect((cx-rw/2, cy-rh/2, cx+rw/2, cy+rh/2), PAPER, LINE, radius=12)
        txt(cx-rw/2 + 25, cy-rh/2 + 20, 'shop.local / account', 18, MUTED, mono=True)
        txt(cx-rw/2 + 25, cy-rh/2 + (69 if square else 49), 'Signed out', 37 if square else 26, bold=True)
        if square:
            txt(cx-rw/2 + 25, cy-rh/2 + 124, 'Old session → 401 Unauthorized', 22, MUTED, mono=True)
        check(cx+rw/2-49, cy-rh/2+(88 if square else 54), stroke=5)
        txt(cx, panel_y + (352 if square else 193), 'Expected behavior. Passing assertion.',
            26 if square else 22, bold=True, anchor='ma')
        if square:
            txt(cx, panel_y + 395, 'The baseline must work before a fault is introduced.', 21, MUTED, anchor='ma')
    elif stage in (1, 2):
        start_y = panel_y + (101 if square else 80)
        cell_w, cell_h, gap = 70, 68 if square else 42, 12
        total = 11 * cell_w + 10 * gap
        left = (1080 - total) / 2
        count = min(22, max(0, int((t-2.05) / 2.25 * 23)))
        for i in range(22):
            row, col = divmod(i, 11)
            x, y = left+col*(cell_w+gap), start_y+row*(cell_h+gap)
            caught = i < count
            rect((x, y, x+cell_w, y+cell_h), BLUSH if caught else PAPER,
                 RED if caught else LINE, radius=8)
            txt(x+cell_w/2, y+(20 if square else 11), f'{i+1:02}', 23 if square else 20,
                RED if caught else MUTED, bold=True, anchor='ma')
        if square:
            txt(540, panel_y + 278, f'{count:02} / 22', 68, bold=True, anchor='ma')
            txt(540, panel_y + 352, 'faults detected by failing assertions', 23, MUTED, anchor='ma')
            if stage == 2:
                rect((104, panel_y+404, 976, panel_y+462), INK, radius=10)
                txt(126, panel_y+422, 'Logout: expected 401 · received 200', 22, WHITE, mono=True)
        else:
            txt(101, panel_y+196, f'{count:02} / 22 detected', 25, bold=True)
            txt(980, panel_y+199, 'Logout: expected 401 · got 200' if stage == 2 else 'Each variant changes one behavior.',
                18, RED if stage == 2 else MUTED, anchor='ra')
    else:
        y = panel_y + (106 if square else 80)
        txt(103, y, '22', 117 if square else 68, bold=True)
        txt(263 if square else 208, y+(27 if square else 12), 'of 22 faults caught', 38 if square else 30, bold=True)
        txt(266 if square else 210, y+(79 if square else 50), 'One healthy control passed.', 23 if square else 20, MUTED)
        rows = [('01', 'Reproduce the failure'), ('02', 'Keep the assertion and trace'),
                ('03', 'Compare with the healthy build')]
        if square:
            for i, (number, label) in enumerate(rows):
                yy = panel_y + 273 + i*59
                d.line((103, yy-12, 977, yy-12), fill=LINE, width=1)
                txt(104, yy, number, 18, MUTED, mono=True)
                txt(158, yy-2, label, 25, bold=True)
                check(946, yy+4)
        else:
            rect((103, panel_y+183, 977, panel_y+226), PAPER, radius=7)
            txt(125, panel_y+195, 'Assertion + trace + report', 20, bold=True)
            txt(954, panel_y+196, 'Evidence you can inspect', 18, MUTED, anchor='ra')

    timeline_y = 872 if square else 516
    labels = ['HEALTHY', 'BREAK', 'DETECT', 'REPORT']
    for i, label in enumerate(labels):
        x = margin + i * 245
        d.rounded_rectangle((x, timeline_y, x+220, timeline_y+4), radius=2,
                            fill=YELLOW if i <= stage else LINE)
        txt(x, timeline_y+18, f'0{i+1}  {label}', 16, INK if i == stage else MUTED, bold=True)

    footer_y = h - (66 if square else 28)
    txt(margin, footer_y, 'Patterns for your agent. Evidence for your team.', 19 if square else 17, MUTED)
    txt(1018, footer_y, 'qa-skills.com', 20 if square else 18, bold=True, anchor='ra')
    # The short fade joins the final report to the opening healthy control cleanly.
    if t > 7.75:
        alpha = ease((t-7.75)/.25)
        im = Image.blend(im, Image.new('RGB', im.size, PAPER), alpha * .75)
    return im.resize((width, height), Image.Resampling.LANCZOS)


def render(out):
    out.mkdir(parents=True, exist_ok=True)
    if not shutil.which('ffmpeg'):
        raise SystemExit('ffmpeg must be installed')
    files = []
    for name, w, h in [('square', 1080, 1080), ('wide', 1280, 720)]:
        video = out / f'qa-skills-proof-{name}.mp4'
        proc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo',
            '-vcodec', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(FPS),
            '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(video)], stdin=subprocess.PIPE)
        try:
            for frame in range(DURATION*FPS):
                proc.stdin.write(make_frame(frame/FPS, w, h).tobytes())
            proc.stdin.close()
            code = proc.wait(timeout=45)
        except BaseException:
            proc.kill()
            proc.wait(timeout=5)
            raise
        if code:
            raise SystemExit(f'ffmpeg exited {code}')
        poster = out / f'qa-skills-proof-{name}.png'
        make_frame(6.6, w, h).save(poster)
        files.extend([video.name, poster.name])
        if name == 'wide':
            gif = out / 'qa-skills-proof.gif'
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(video),
                '-filter_complex', 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
                '-loop', '0', str(gif)], check=True, timeout=45)
            files.append(gif.name)
    manifest = {'durationSeconds': DURATION, 'fps': FPS, 'format': 'motion graphic',
                'claim': '22 controlled local faults detected, plus a passing healthy control',
                'basisCommit': '462126bcc4d3bfe94a7c064b848c690c1366f343',
                'basis': ['docs/REAL-WORKFLOWS-2026-10-21.md', 'tests/workflows/run-matrix.mjs'],
                'notDepicted': 'No automated source repair or provider payment is depicted.',
                'files': files}
    (out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    render(parser.parse_args().out)
