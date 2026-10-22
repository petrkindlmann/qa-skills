#!/usr/bin/env python3
"""Render two 5-second vertical cuts of 'Green isn't correct.'; use --out DIRECTORY.

layout:  Passed. / Missed. / Caught. / Tests need tests.
session: Signed out. / Still signed in. / Tests need tests.

Drawn illustrations of the controlled fixtures at v3.4.0, not screen recordings.
Palette, fonts, wrapping and the encoder come from render-green-lies.py.
"""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
import sys

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('green_lies', HERE/'render-green-lies.py')
gl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gl)

FPS = gl.FPS
DURATION = 5
FRAME_COUNT = DURATION * FPS
WIDTH, HEIGHT = 1080, 1920
LEFT, RIGHT = 62, 1018
CARD_Y, CARD_H = 400, 690
DISCLOSURE = 'Controlled fixture illustration.'
COMMAND = 'npx skills add petrkindlmann/qa-skills'

# Beat start frames; each cut sits on the 24 fps grid.
CUTS = {
    'layout': (0, 30, 60, 90),
    'session': (0, 40, 80),
}
JUMP_FRAME = 40
CAPTIONS = {
    'layout': [('Passed.', 'Layout shift is under budget.'),
               ('Missed.', 'The entry field moved 240 px.'),
               ('Caught.', 'Once a test pinned the field.'),
               None],
    'session': [('Signed out.', 'The browser test passed.'),
                ('Still signed in.', 'A copied cookie still works.'),
                None],
}
FINAL_MATRIX = 'docs/workflow-addons-2026-10-21/evidence/final-matrix/matrix.json'
EVIDENCE = {
    'layout': [gl.EVIDENCE[2], {
        'part': 'CAUGHT',
        'source': FINAL_MATRIX,
        'fact': 'Run todo-layout-shift: the CLS budget assertion passed and "entry field moved after first render" failed, y 130 -> 370.',
    }],
    'session': [gl.EVIDENCE[1]],
}


def beat(cut, frame):
    starts = CUTS[cut]
    index = max(i for i, start in enumerate(starts) if start <= frame)
    elapsed = (frame - starts[index]) / FPS
    offset = round(10 * (1 - min(1, elapsed / gl.SETTLE_SECONDS)) ** 3)
    return index, offset


def state(cut, frame):
    index, offset = beat(cut, frame)
    jumped = cut == 'layout' and index == 1 and frame >= JUMP_FRAME
    return cut, index, offset, jumped


def make_frame(cut, frame, audit=None):
    if not 0 <= frame < FRAME_COUNT:
        raise ValueError(f'frame must be in 0..{FRAME_COUNT-1}')
    _, index, offset, jumped = state(cut, frame)
    im = Image.new('RGB', (WIDTH, HEIGHT), gl.PAPER)
    d = ImageDraw.Draw(im)
    items = []
    y = CARD_Y + offset

    def txt(x, yy, text, size, fill=gl.INK, bold=False, mono=False, anchor='lt',
            role='card', bounds=None):
        face = gl.font(size, bold, mono)
        box = d.textbbox((x, yy), text, font=face, anchor=anchor)
        limit = bounds or (0, 0, WIDTH, HEIGHT)
        if box[0] < limit[0] or box[1] < limit[1] or box[2] > limit[2] or box[3] > limit[3]:
            raise ValueError(f'{cut} frame {frame}: clipped {role}: {text!r}, {box} outside {limit}')
        d.text((x, yy), text, font=face, fill=fill, anchor=anchor)
        items.append({'text': text, 'role': role, 'bounds': list(box)})

    def rect(box, fill=gl.WHITE, outline=None, radius=18, stroke=1):
        d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=stroke)

    def card(box, fill=gl.WHITE):
        x0, y0, x1, y1 = box
        rect((x0, y0+6, x1, y1+6), gl.SHADOW)
        rect(box, fill, gl.LINE if fill == gl.WHITE else None)

    def terminal(values, top, height, size=40, leading=58):
        card((LEFT, top, RIGHT, top+height), gl.INK)
        first = top + (height - len(values)*leading)/2 + 6
        for i, value in enumerate(values):
            color = gl.YELLOW if value.startswith('✔') else '#F08A7E' if value.startswith('✘') else gl.WHITE
            txt(LEFT+30, first+i*leading, value, size, color, mono=True,
                bounds=(LEFT+20, top+16, RIGHT-20, top+height-16))

    def browser(top, bottom):
        card((LEFT, top, RIGHT, bottom))
        for i in range(3):
            d.ellipse((LEFT+22+i*18, top+13, LEFT+29+i*18, top+20), fill=gl.LINE)
        d.line((LEFT, top+33, RIGHT, top+33), fill=gl.LINE, width=1)

    rect((LEFT, 58, LEFT+38, 96), gl.YELLOW, radius=8)
    txt(LEFT+19, 63, 'q', 30, bold=True, anchor='mt', role='brand')
    txt(LEFT+52, 65, 'qa skills', 30, bold=True, role='brand')
    d.line((LEFT, 122, RIGHT, 122), fill=gl.LINE, width=1)

    caption = CAPTIONS[cut][index]
    if caption is None:
        title_top = 470 + offset
        txt(LEFT, title_top, 'Tests need tests.', 104, bold=True)
        rect((LEFT, title_top+124, LEFT+126, title_top+132), gl.YELLOW, radius=4)
        command_top = title_top + 190
        lines = gl.wrapped(COMMAND, gl.font(40, mono=True), RIGHT-LEFT-44)
        rect((LEFT, command_top-14, RIGHT, command_top-14+len(lines)*54+34), gl.INK, radius=12)
        for i, value in enumerate(lines):
            txt(LEFT+22, command_top+4+i*54, value, 40, gl.WHITE, mono=True)
    elif cut == 'layout' and index in (0, 2):
        if index == 0:
            values = ['cls-after-load: 0.072', 'budget 0.10', '✔ layout stays stable']
        else:
            values = ['$ npx playwright test', '✔ cls 0.072 < budget 0.10',
                      '✘ entry field moved after', '  first render', '  y: 130 → 370']
        terminal(values, y, CARD_H)
    elif cut == 'layout' and index == 1:
        browser(y, y+CARD_H)
        # The illustrated viewport is 1440 CSS px wide, as in the parent piece.
        vx, vy = LEFT+16, y+36
        vw = RIGHT-LEFT-32
        css_scale = vw/1440
        banner_css = 240 if jumped else 0
        shift = banner_css*css_scale
        if jumped:
            d.rectangle((vx, vy, vx+vw, vy+shift), fill=gl.YELLOW)
            txt(540, vy+shift/2-15, 'This site uses cookies.', 34, bold=True, anchor='mt',
                bounds=(vx, vy, vx+vw, vy+shift))
        app_w = (1440-160)*css_scale
        app_x = (WIDTH-app_w)/2
        app_y = vy+20*css_scale+shift
        entry_h = 56*css_scale
        rect((app_x, app_y, app_x+app_w, app_y+entry_h), gl.WHITE, gl.INK if jumped else gl.LINE,
             radius=max(4, round(8*css_scale)), stroke=2)
        for row in range(3):
            row_y = vy+(90+48*row)*css_scale+shift
            row_h = 34*css_scale
            rect((app_x, row_y, app_x+app_w, row_y+row_h), gl.PAPER, radius=4)
            side = 18*css_scale
            rect((app_x+16*css_scale, row_y+8*css_scale, app_x+16*css_scale+side,
                  row_y+8*css_scale+side), gl.WHITE, gl.MUTED, radius=2)
            d.line((app_x+54*css_scale, row_y+row_h/2, app_x+(680-110*row)*css_scale,
                    row_y+row_h/2), fill=gl.LINE, width=max(2, round(5*css_scale)))
        if audit is not None:
            audit['layoutJump'] = {'cssPixels': banner_css, 'entryYInCssPixels': 20+banner_css}
    elif cut == 'session' and index == 0:
        terminal_h = 138
        bottom = y+CARD_H-terminal_h-14
        browser(y, bottom)
        txt(LEFT+30, y+53, 'Shop', 44, bold=True)
        txt(540, y+(bottom-y)/2+16, 'Signed out', 62, bold=True, anchor='mt')
        # The copied cookie is the ticket the next beat reuses.
        ticket_y = bottom-110
        ticket = 'shop_session · copied earlier'
        ticket_right = LEFT+40+gl.font(30, mono=True).getlength(ticket)+44
        rect((LEFT+40, ticket_y, ticket_right, ticket_y+70), gl.YELLOW, radius=10)
        txt(LEFT+62, ticket_y+16, ticket, 30, mono=True,
            bounds=(LEFT+40, ticket_y, ticket_right, ticket_y+70))
        terminal(['✔ sign out clears the session', '  (1 passed)'], bottom+14, terminal_h)
    elif cut == 'session' and index == 1:
        card((LEFT, y, RIGHT, y+CARD_H))
        request = ['GET /api/me', 'Cookie: shop_session=', '<copied earlier>']
        response = ['200  {"user":{"id":"alice",', '      "email":"alice@example.test"}}']
        leading, gap = 58, 40
        top = y + (CARD_H-(len(request)+len(response))*leading-gap)/2 + 5
        bounds = (LEFT+20, y+16, RIGHT-20, y+CARD_H-16)
        for i, value in enumerate(request):
            txt(LEFT+30, top+i*leading, value, 40, mono=True, bounds=bounds)
        rule_y = top + len(request)*leading + gap/2 - 5
        d.line((LEFT+30, rule_y, RIGHT-30, rule_y), fill=gl.LINE, width=2)
        response_y = top + len(request)*leading + gap
        rect((LEFT+13, response_y, LEFT+18, response_y+26), gl.YELLOW, radius=2)
        for i, value in enumerate(response):
            txt(LEFT+30, response_y+i*leading, value, 40, mono=True, bounds=bounds)

    if caption is not None:
        title, sub = caption
        txt(LEFT, 1172, title, 96, bold=True, role='caption')
        for i, value in enumerate(gl.wrapped(sub, gl.font(48), RIGHT-LEFT)):
            txt(LEFT, 1300+i*62, value, 48, gl.MUTED, role='caption')

    # Beat marks instead of the parent's three named segments.
    marks = len(CUTS[cut])
    gap = 18
    segment_w = (RIGHT-LEFT-(marks-1)*gap)/marks
    for i in range(marks):
        x = LEFT+i*(segment_w+gap)
        rect((x, HEIGHT-200, x+segment_w, HEIGHT-194), gl.YELLOW if i <= index else gl.LINE, radius=3)
    txt(LEFT, HEIGHT-150, DISCLOSURE, 30, gl.MUTED, role='disclosure')
    txt(RIGHT, HEIGHT-74, 'qa-skills.com', 28, bold=True, anchor='rt', role='brand')

    if audit is not None:
        audit.update(cut=cut, frame=frame, timeSeconds=frame/FPS, texts=items)
    return im


def render_mp4(cut, path):
    command = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
               '-s', f'{WIDTH}x{HEIGHT}', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libx264',
               '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
               '-threads', '2', str(path)]
    import subprocess
    proc = subprocess.Popen(command, stdin=subprocess.PIPE)
    cache = {}
    try:
        for frame in range(FRAME_COUNT):
            key = state(cut, frame)
            if key not in cache:
                cache[key] = make_frame(cut, frame).tobytes()
            proc.stdin.write(cache[key])
        proc.stdin.close()
        if proc.wait(timeout=120):
            raise RuntimeError(f'ffmpeg failed: {path}')
    except BaseException:
        proc.kill()
        proc.wait(timeout=5)
        raise


def render(out):
    out = out.resolve()
    review = out/'review'
    review.mkdir(parents=True, exist_ok=True)
    checks, files, provenance = {}, [], {}
    repo = HERE.parent
    for cut in CUTS:
        path = out/f'qa-skills-green-lies-{cut}-vertical.mp4'
        print(f'Rendering {cut}: {WIDTH}x{HEIGHT}, {FRAME_COUNT} frames', flush=True)
        render_mp4(cut, path)
        metadata = gl.probe(path)
        stream = metadata['streams'][0]
        assert stream['codec_name'] == 'h264'
        assert (stream['width'], stream['height']) == (WIDTH, HEIGHT)
        assert stream['r_frame_rate'] == stream['avg_frame_rate'] == f'{FPS}/1'
        assert int(stream['nb_frames']) == FRAME_COUNT
        assert abs(float(metadata['format']['duration'])-DURATION) < 0.000001
        # Every frame is drawn once with clipping checks; review frames come from the
        # encoded file, one per beat at its settled midpoint.
        for frame in range(FRAME_COUNT):
            make_frame(cut, frame, {})
        starts = (*CUTS[cut], FRAME_COUNT)
        sampled = []
        for i in range(len(CUTS[cut])):
            frame = (starts[i]+starts[i+1])//2
            if cut == 'layout' and i == 1:
                frame = max(frame, JUMP_FRAME+6)
            frame_path = review/f'{cut}-beat{i+1}.png'
            gl.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(path), '-vf',
                    f'select=eq(n\\,{frame})', '-frames:v', '1', str(frame_path)])
            audit = {}
            make_frame(cut, frame, audit)
            audit['file'] = str(frame_path.relative_to(out))
            sampled.append(audit)
        if cut == 'layout':
            before, after = {}, {}
            make_frame(cut, JUMP_FRAME-1, before)
            make_frame(cut, JUMP_FRAME, after)
            assert after['layoutJump']['entryYInCssPixels']-before['layoutJump']['entryYInCssPixels'] == 240
        sheet = Image.new('RGB', (270*len(sampled), 480), gl.PAPER)
        for i, audit in enumerate(sampled):
            with Image.open(out/audit['file']) as im:
                sheet.paste(im.resize((270, 480), Image.Resampling.LANCZOS), (270*i, 0))
        sheet.save(review/f'{cut}-review.png')
        checks[cut] = {'mp4': metadata, 'frames': sampled, 'textBounds': 'pass'}
        files.append(path)
        evidence = []
        for item in EVIDENCE[cut]:
            item = dict(item)
            sources = [item['source'], *item.get('supportingSources', [])]
            item['url'] = f'https://github.com/petrkindlmann/qa-skills/blob/{gl.BASE_COMMIT}/{item["source"]}'
            item['sourceSha256'] = {s: hashlib.sha256((repo/s).read_bytes()).hexdigest() for s in sources}
            evidence.append(item)
        provenance[cut] = {'beats': [c[0] if c else 'Tests need tests.' for c in CAPTIONS[cut]],
                           'cutFrames': CUTS[cut], 'evidence': evidence}
    (out/'verification.json').write_text(json.dumps(checks, indent=2)+'\n')
    manifest = {'title': "Green isn't correct. Vertical cuts", 'format': 'drawn motion graphic',
                'baseTag': 'v3.4.0', 'baseCommit': gl.BASE_COMMIT, 'durationSeconds': DURATION,
                'fps': FPS, 'frameCount': FRAME_COUNT, 'disclosure': DISCLOSURE, 'cuts': provenance,
                'renderCommand': f'python3 scripts/render-green-lies-shorts.py --out {shlex.quote(str(out))}',
                'rendererSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'parentRendererSha256': hashlib.sha256((HERE/'render-green-lies.py').read_bytes()).hexdigest(),
                'runtime': {'python': sys.version.split()[0], 'pillow': PILLOW_VERSION,
                            'sansFont': str(gl.font(34).path), 'monoFont': str(gl.font(34, mono=True).path)},
                'files': [{'path': p.name, 'bytes': p.stat().st_size,
                           'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
    (out/'provenance.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'output': str(out), 'files': [p.name for p in files]}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    render(parser.parse_args().out)
