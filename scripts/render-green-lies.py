#!/usr/bin/env python3
"""Render 'Green isn't correct.' with Pillow and ffmpeg; use --out DIRECTORY.

This is a drawn illustration of the controlled fixtures at v3.4.0, not a
screen recording. The supplied terminal labels are illustrative stand-ins.
Requires Python 3.10+, Pillow, ffmpeg (libx264), ffprobe, and a TrueType font.
No network, fixture server, browser, or additional Python package is needed.
"""

import argparse
from bisect import bisect_right
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont, __version__ as PILLOW_VERSION


PAPER = '#F6F5F0'
INK = '#191B1D'
MUTED = '#66696B'
LINE = '#DADBD5'
YELLOW = '#F1D655'
WHITE = '#FFFFFF'
SHADOW = '#E6E5DF'
DURATION = 15
FPS = 24
FRAME_COUNT = DURATION * FPS
BASE_COMMIT = '37a94c2d3e880667daffdc2153095b2b7a30f56b'
STARTS = (0, 1, 3, 5, 7, 9, 11, 13)
SAMPLE_SECONDS = (2, 4, 6, 8, 10, 12, 14)
FORMATS = (('wide', 1280, 720), ('square', 1080, 1080),
           ('vertical', 1080, 1920))
JUMP_FRAME = math.ceil(11.4 * FPS)
SETTLE_SECONDS = 0.20
CAPTIONS = {
    1: 'Looks ready to ship.',
    2: 'Free shipping was promised at 5000. The customer paid 500 more.',
    3: 'The browser signed out.',
    4: "The server didn't. A copied cookie still works.",
    5: 'Layout shift is under budget.',
    6: "The entry field moved 240 px. The score didn't notice.",
}
EVIDENCE = [
    {
        'part': '01 SHIPPING',
        'source': 'docs/evidence/qa-orchestration-2026-10-21/field-use/evidence/REPORT.md',
        'supportingSources': [
            'docs/evidence/qa-orchestration-2026-10-21/field-use/README.md',
            'docs/evidence/qa-orchestration-2026-10-21/field-use/evidence/source.diff',
        ],
        'fact': 'Three original tests passed; subtotal 5000 should get free standard shipping, but shipping was 500 and total 5500.',
        'copyNote': 'The supplied terminal test titles are illustrative; the baseline titles were standard shipping below threshold, standard shipping above threshold, and express cost.',
    },
    {
        'part': '02 SESSION',
        'source': 'tests/workflows/generated/review-followup/shop-review.spec.mjs',
        'supportingSources': ['tests/workflows/fixture-app/faults.py',
                              'tests/workflows/fixture-app/server.py'],
        'fact': 'With logout_cookie_only, an independently copied session cookie is accepted after browser logout; the first review regression requires 401 and unauthenticated.',
        'copyNote': 'The supplied passing line stands in for the baseline logout test, API auth, cookie contract and logout revoke access.',
    },
    {
        'part': '03 LAYOUT',
        'source': 'docs/workflow-addons-2026-10-21/evidence/escaped-layout-shift.json',
        'supportingSources': ['tests/workflows/upstream-todomvc/faults/mutations.mjs'],
        'fact': 'A 240 CSS-pixel banner is inserted 400 ms after load. Recorded CLS was 0.07241615295410155, below 0.1; on-screen 0.072 is rounded.',
    },
]


@lru_cache(maxsize=128)
def font(size, bold=False, mono=False):
    candidates = ([
        '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
        '/System/Library/Fonts/Menlo.ttc',
        '/System/Library/Fonts/Supplemental/Courier New.ttf',
    ] if mono else [
        '/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf' if bold else
        '/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
    ])
    for candidate in candidates:
        if Path(candidate).is_file():
            return ImageFont.truetype(candidate, round(size))
    raise RuntimeError('Install DejaVu Sans / Sans Mono, Nimbus Sans, or the macOS fonts listed in font().')


@lru_cache(maxsize=16)
def symbol_font(size):
    # DejaVu Sans Mono lacks U+2139. Keep its fixed-width cell and use a
    # real information glyph inside it, as a terminal's fallback font does.
    for path in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                 '/System/Library/Fonts/Apple Symbols.ttf',
                 '/System/Library/Fonts/Helvetica.ttc'):
        if Path(path).is_file():
            candidate = ImageFont.truetype(path, round(size))
            if bytes(candidate.getmask('ℹ')) != bytes(candidate.getmask('\u0378')):
                return candidate
    raise RuntimeError('Install DejaVu Sans or Apple Symbols for the ℹ glyph.')


def layout(width, height):
    h = round(height * 1080 / width)
    if h > 1400:
        return dict(h=h, mode='vertical', y=400, card_h=690, caption_y=1172,
                    body=40, leading=58, caption=54, caption_leading=66,
                    bar=h-200, footer=h-74, css_width=1080)
    if h > 800:
        return dict(h=h, mode='square', y=244, card_h=430, caption_y=748,
                    body=36, leading=48, caption=42, caption_leading=52,
                    bar=h-136, footer=h-48, css_width=1440)
    return dict(h=h, mode='wide', y=124, card_h=268, caption_y=422,
                body=34, leading=42, caption=36, caption_leading=44,
                bar=536, footer=h-28, css_width=1920)


def wrapped(text, face, max_width):
    """Wrap only at existing spaces; never alter a word or insert punctuation."""
    lines, current = [], ''
    for word in text.split(' '):
        trial = f'{current} {word}' if current else word
        if current and face.getlength(trial) > max_width:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)
    return lines


def scene_state(frame):
    t = frame / FPS
    stage = min(7, bisect_right(STARTS, t) - 1)
    elapsed = t - STARTS[stage]
    # Only the foreground card moves. No fades, scrolling, or animated bar.
    offset = round(10 * (1 - min(1, elapsed / SETTLE_SECONDS)) ** 3)
    return stage, offset, t >= 5.4, frame >= JUMP_FRAME


def make_frame(frame, width, height, audit=None):
    """Frame index, not time: all cuts and motion stay on the 24 fps grid."""
    if not 0 <= frame < FRAME_COUNT:
        raise ValueError('frame must be in 0..359')
    spec = layout(width, height)
    h, mode = spec['h'], spec['mode']
    im = Image.new('RGB', (1080, h), PAPER)
    d = ImageDraw.Draw(im)
    stage, offset, signed_out, jumped = scene_state(frame)
    left, right = 62, 1018
    y, card_h = spec['y'] + offset, spec['card_h']
    face_size, leading = spec['body'], spec['leading']
    items = []

    def txt(x, yy, text, size=34, fill=INK, bold=False, mono=False,
            anchor='lt', role='card', bounds=None):
        face = font(size, bold, mono)
        box = d.textbbox((x, yy), text, font=face, anchor=anchor)
        limit = bounds or (0, 0, 1080, h)
        if box[0] < limit[0] or box[1] < limit[1] or box[2] > limit[2] or box[3] > limit[3]:
            raise ValueError(f'{mode} frame {frame}: clipped {role}: {text!r}, {box} outside {limit}')
        if mono and 'ℹ' in text:
            d.text((x, yy), text.replace('ℹ', ' '), font=face, fill=fill, anchor=anchor)
            cell = face.getlength(' ')
            for index, char in enumerate(text):
                if char == 'ℹ':
                    d.text((x+face.getlength(text[:index])+cell/2, yy+2), char,
                           font=symbol_font(size), fill=fill, anchor='mt')
        else:
            d.text((x, yy), text, font=face, fill=fill, anchor=anchor)
        items.append({'text': text, 'role': role, 'bounds': list(box),
                      'fontPixelsAt480Wide': round(size * 480 / 1080, 2)})

    def rect(box, fill=WHITE, outline=None, radius=18, stroke=1):
        d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=stroke)

    def card(box, fill=WHITE):
        x0, y0, x1, y1 = box
        rect((x0, y0+6, x1, y1+6), SHADOW)
        rect(box, fill, LINE if fill == WHITE else None)

    def lines(values, x, yy, color=INK, size=None, line_h=None, bounds=None):
        for i, value in enumerate(values):
            txt(x, yy+i*(line_h or leading), value, size or face_size, color,
                mono=True, bounds=bounds)

    def browser_chrome(top, bottom):
        card((left, top, right, bottom))
        for i in range(3):
            d.ellipse((left+22+i*18, top+13, left+29+i*18, top+20), fill=LINE)
        d.line((left, top+33, right, top+33), fill=LINE, width=1)

    # Shared framing matches render-proof-animation.py. Only supplied copy is drawn.
    logo_y = 58 if mode == 'vertical' else 38
    rect((left, logo_y, left+38, logo_y+38), YELLOW, radius=8)
    txt(left+19, logo_y+5, 'q', 30, bold=True, anchor='mt', role='brand')
    txt(left+52, logo_y+7, 'qa skills', 30, bold=True, role='brand')
    d.line((left, logo_y+64, right, logo_y+64), fill=LINE, width=1)

    if stage in (0, 7):
        vertical = mode == 'vertical'
        title_top = (470 if vertical else 348 if mode == 'square' else 186) + offset
        title = "Green isn't correct." if stage == 0 else 'Tests need tests.'
        title_lines = wrapped(title, font(104 if vertical else 82, True), right-left)
        for i, value in enumerate(title_lines):
            txt(left, title_top+i*(116 if vertical else 94), value,
                104 if vertical else 82, bold=True)
        underline_y = title_top + len(title_lines)*(116 if vertical else 94) + 8
        rect((left, underline_y, left+126, underline_y+8), YELLOW, radius=4)
        sub_y = underline_y + (55 if vertical else 44)
        if stage == 0:
            sub = 'Three passing suites. Three shipped bugs.'
            sub_size = 48 if vertical else 38
            for i, value in enumerate(wrapped(sub, font(sub_size), right-left)):
                txt(left, sub_y+i*(62 if vertical else 48), value, sub_size, MUTED)
        else:
            command = 'npx skills add petrkindlmann/qa-skills'
            command_size = 40 if vertical else 34
            command_lines = wrapped(command, font(command_size, mono=True), right-left-44)
            command_h = len(command_lines)*(54 if vertical else 44)+34
            rect((left, sub_y-14, right, sub_y-14+command_h), INK, radius=12)
            for i, value in enumerate(command_lines):
                txt(left+22, sub_y+4+i*(54 if vertical else 44), value,
                    command_size, WHITE, mono=True)
            foot_y = sub_y + command_h + (52 if vertical else 30)
            footer_size = 31 if vertical else 25
            for i, value in enumerate(['Controlled local fixtures. See',
                                      'docs/REAL-WORKFLOWS-2026-10-21.md']):
                txt(left, foot_y+i*(42 if vertical else 32), value, footer_size, MUTED,
                    role='disclosure')
    elif stage in (1, 5):
        card((left, y, right, y+card_h), INK)
        if stage == 1:
            values = ['$ npm test', '✔ quote standard below threshold',
                      '✔ quote express', '✔ health', 'ℹ pass 3   ℹ fail 0']
        else:
            values = ['cls-after-load: 0.072', 'budget 0.10', '✔ layout stays stable']
        top = y + (card_h-len(values)*leading)/2 + 6
        for i, value in enumerate(values):
            txt(left+30, top+i*leading, value, face_size,
                YELLOW if value.startswith(('✔', 'ℹ')) else WHITE,
                mono=True, bounds=(left+20, y+16, right-20, y+card_h-16))
    elif stage in (2, 4):
        card((left, y, right, y+card_h))
        if stage == 2:
            request = ['POST /quote', '{"subtotal":5000,"method":"standard"}']
            response = ['200  {"subtotal":5000,"shipping":500,', '      "total":5500}']
        else:
            request = ['GET /api/me', 'Cookie: shop_session=', '<copied before sign-out>']
            response = ['200  {"user":{"id":"alice",', '      "email":"alice@example.test"}}']
        gap = 22 if mode == 'wide' else 40
        http_leading = 38 if mode == 'wide' else leading
        top = y + (card_h-(len(request)+len(response))*http_leading-gap)/2 + 5
        bounds = (left+20, y+16, right-20, y+card_h-16)
        lines(request, left+30, top, line_h=http_leading, bounds=bounds)
        rule_y = top + len(request)*http_leading + gap/2 - 5
        d.line((left+30, rule_y, right-30, rule_y), fill=LINE, width=2)
        response_y = top + len(request)*http_leading + gap
        # A small yellow marker accents the response without adding copy.
        rect((left+13, response_y, left+18, response_y+26), YELLOW, radius=2)
        lines(response, left+30, response_y, line_h=http_leading, bounds=bounds)
    elif stage == 3:
        terminal_h = 76 if mode == 'wide' else 138 if mode == 'vertical' else 90
        browser_bottom = y+card_h-terminal_h-14
        browser_chrome(y, browser_bottom)
        header_y = y+53
        txt(left+30, header_y, 'Shop', 34 if mode != 'vertical' else 44, bold=True)
        if signed_out:
            txt(540, y+100 if mode == 'wide' else y+(browser_bottom-y)/2+16,
                'Signed out', 44 if mode == 'wide' else 62, bold=True, anchor='mt')
        else:
            # Press state is a hard state change, not a moving cursor.
            button_y = header_y-10
            rect((right-205, button_y, right-25, button_y+52), INK, radius=10)
            txt(right-115, button_y+13, 'Sign out', 30, YELLOW, bold=True, anchor='mt')
        terminal_y = browser_bottom+14
        card((left, terminal_y, right, y+card_h), INK)
        values = (['✔ sign out clears the session', '  (1 passed)'] if mode == 'vertical'
                  else ['✔ sign out clears the session   (1 passed)'])
        top = terminal_y+(terminal_h-len(values)*leading)/2+5
        lines(values, left+30, top, color=YELLOW, size=40 if mode == 'vertical' else 34,
              bounds=(left+20, terminal_y+8, right-20, y+card_h-8))
    elif stage == 6:
        browser_chrome(y, y+card_h)
        # CSS pixels belong to the depicted browser viewport, not the exported
        # video raster. Scale the entire UI consistently into each aspect ratio.
        vx, vy = left+16, y+36
        vw = right-left-32
        css_scale = vw/spec['css_width']
        banner_css = 240 if jumped else 0
        shift = banner_css*css_scale
        if jumped:
            d.rectangle((vx, vy, vx+vw, vy+shift), fill=YELLOW)
            txt(540, vy+shift/2-15, 'This site uses cookies.',
                34 if mode == 'wide' else 40, bold=True, anchor='mt',
                bounds=(vx, vy, vx+vw, vy+shift))
        app_w = min(1360, spec['css_width']-160)*css_scale
        app_x = (1080-app_w)/2
        app_y = vy+20*css_scale+shift
        entry_h = 56*css_scale
        rect((app_x, app_y, app_x+app_w, app_y+entry_h), WHITE, LINE,
             radius=max(4, round(8*css_scale)), stroke=2)
        d.line((app_x+24*css_scale, app_y+entry_h/2,
                app_x+24*css_scale, app_y+entry_h/2+12*css_scale), fill=INK,
               width=max(1, round(2*css_scale)))
        for row in range(3):
            row_y = vy+(90+48*row)*css_scale+shift
            row_h = 34*css_scale
            rect((app_x, row_y, app_x+app_w, row_y+row_h), PAPER, radius=4)
            side = 18*css_scale
            rect((app_x+16*css_scale, row_y+8*css_scale,
                  app_x+16*css_scale+side, row_y+8*css_scale+side), WHITE, MUTED, radius=2)
            d.line((app_x+54*css_scale, row_y+row_h/2,
                    app_x+(680-110*row)*css_scale, row_y+row_h/2), fill=LINE,
                   width=max(2, round(5*css_scale)))
        if audit is not None:
            audit['layoutJump'] = {'cssPixels': banner_css, 'viewportScale': css_scale,
                                   'entryYInCssPixels': 20+banner_css,
                                   'entryYInVideoPixels': app_y*height/h,
                                   'bannerHeightInVideoPixels': shift*height/h}

    if stage in CAPTIONS:
        caption = CAPTIONS[stage]
        values = wrapped(caption, font(spec['caption'], True), right-left)
        for i, value in enumerate(values):
            txt(left, spec['caption_y']+i*spec['caption_leading'], value,
                spec['caption'], bold=True, role='caption',
                bounds=(left, 0, right, spec['bar']-20))

    active = (stage-1)//2 if stage in range(1, 7) else None
    gap = 24
    segment_w = (right-left-2*gap)/3
    for i, label in enumerate(('01 SHIPPING', '02 SESSION', '03 LAYOUT')):
        x = left+i*(segment_w+gap)
        rect((x, spec['bar'], x+segment_w, spec['bar']+6),
             YELLOW if active == i else LINE, radius=3)
        txt(x, spec['bar']+18, label, 24 if mode != 'vertical' else 30,
            INK if active == i else MUTED, bold=True, role='progress')
    txt(right, spec['footer'], 'qa-skills.com', 22 if mode != 'vertical' else 28,
        bold=True, anchor='rt', role='brand')

    if audit is not None:
        audit.update(frame=frame, timeSeconds=frame/FPS, format=mode,
                     width=width, height=height, texts=items)
    return im.resize((width, height), Image.Resampling.LANCZOS)


def run(command, **kwargs):
    return subprocess.run(command, check=True, timeout=180, **kwargs)


def render_mp4(path, width, height):
    command = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo',
               '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(FPS),
               '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
               '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '2', str(path)]
    proc = subprocess.Popen(command, stdin=subprocess.PIPE)
    cache = {}
    try:
        for frame in range(FRAME_COUNT):
            state = scene_state(frame)
            if state not in cache:
                cache[state] = make_frame(frame, width, height).tobytes()
            proc.stdin.write(cache[state])
        proc.stdin.close()
        code = proc.wait(timeout=120)
        if code:
            raise RuntimeError(f'ffmpeg exited {code}: {path}')
    except BaseException:
        proc.kill()
        proc.wait(timeout=5)
        raise


def probe(path):
    result = run(['ffprobe', '-v', 'error', '-show_entries',
                  'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:format=duration',
                  '-of', 'json', str(path)], capture_output=True, text=True)
    return json.loads(result.stdout)


def render_gif(path):
    # GIF timestamps use centiseconds: 40/50 ms delays approximate 24 fps,
    # with the total exactly 15000 ms. Consecutive identical frames merge.
    frames, durations, previous = [], [], None
    for frame in range(FRAME_COUNT):
        state = scene_state(frame)
        delay = (round((frame+1)*100/FPS)-round(frame*100/FPS))*10
        if state == previous:
            durations[-1] += delay
        else:
            frames.append(make_frame(frame, 960, 540))
            durations.append(delay)
        previous = state
    # One palette for all cuts avoids flicker and makes delta-frame compression
    # efficient. A 24 fps GIF does not need hundreds of identical stored frames.
    contact = Image.new('RGB', (480, 270*len(frames)), PAPER)
    for i, im in enumerate(frames):
        contact.paste(im.resize((480, 270)), (0, i*270))
    palette = contact.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
    indexed = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in frames]
    indexed[0].save(path, save_all=True, append_images=indexed[1:], duration=durations,
                    loop=0, optimize=True, disposal=1)
    if path.stat().st_size >= 2_500_000:
        raise RuntimeError(f'GIF exceeds 2.5 MB: {path.stat().st_size} bytes')


def render(out):
    out = out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    for tool in ('ffmpeg', 'ffprobe'):
        if not shutil.which(tool):
            raise SystemExit(f'{tool} must be installed')
    checks = {'mp4': {}, 'frames': [], 'textBounds': 'pass',
              'captionMinimumFontPixelsAt480Wide': 16.0}
    files = []
    review = out/'review'
    review.mkdir(exist_ok=True)
    for name, width, height in FORMATS:
        path = out/f'qa-skills-green-lies-{name}.mp4'
        print(f'Rendering {name}: {width}x{height}, {FRAME_COUNT} frames', flush=True)
        render_mp4(path, width, height)
        metadata = probe(path)
        stream = metadata['streams'][0]
        assert stream['codec_name'] == 'h264'
        assert (stream['width'], stream['height']) == (width, height)
        assert stream['r_frame_rate'] == stream['avg_frame_rate'] == '24/1'
        assert int(stream['nb_frames']) == FRAME_COUNT
        assert abs(float(metadata['format']['duration'])-DURATION) < 0.000001
        checks['mp4'][name] = metadata
        files.append(path)
        # Retain frames extracted from the encoded video, not just design inputs.
        for seconds in SAMPLE_SECONDS:
            frame_path = review/f'{name}-{seconds:02d}s.png'
            run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(path),
                 '-vf', f'select=eq(n\\,{seconds*FPS})', '-frames:v', '1', str(frame_path)])
            audit = {}
            make_frame(seconds*FPS, width, height, audit)
            audit['file'] = str(frame_path.relative_to(out))
            checks['frames'].append(audit)
        # Audit every card-settle position, state change, cut, and the layout jump.
        boundary_frames = {0, FRAME_COUNT-1, JUMP_FRAME-1, JUMP_FRAME, 130}
        for start in STARTS:
            boundary_frames.update(range(start*FPS, min(FRAME_COUNT, start*FPS+6)))
            if start:
                boundary_frames.add(start*FPS-1)
        for frame in sorted(boundary_frames):
            make_frame(frame, width, height, {})
        before, after = {}, {}
        make_frame(JUMP_FRAME-1, width, height, before)
        make_frame(JUMP_FRAME, width, height, after)
        assert after['layoutJump']['entryYInCssPixels']-before['layoutJump']['entryYInCssPixels'] == 240
    gif = out/'qa-skills-green-lies.gif'
    print('Rendering and checking the looping 960x540 GIF', flush=True)
    render_gif(gif)
    with Image.open(gif) as im:
        loop = im.info.get('loop')
        total_ms = 0
        for frame in range(im.n_frames):
            im.seek(frame)
            total_ms += im.info['duration']
        assert loop == 0 and im.size == (960, 540) and total_ms == 15000
        checks['gif'] = {'width': 960, 'height': 540, 'loop': loop,
                         'durationMs': total_ms, 'storedFrames': im.n_frames,
                         'bytes': gif.stat().st_size, 'under2500000Bytes': True,
                         'sourceFps': FPS,
                         'timing': '40/50 ms centisecond cadence; identical frames merged'}
    files.append(gif)
    cover = out/'qa-skills-green-lies-cover.png'
    make_frame(12, 1280, 720).save(cover)
    files.append(cover)
    checks['layoutJump'] = {'requestedTimeSeconds': 11.4, 'frame': JUMP_FRAME,
                            'timeSeconds': JUMP_FRAME/FPS, 'deltaCssPixels': 240,
                            'transitionFrames': 1,
                            'note': 'First frame on or after 11.4 s; CSS pixels scale with the illustrated viewport.'}
    (out/'verification.json').write_text(json.dumps(checks, indent=2)+'\n')
    repo = Path(__file__).resolve().parent.parent
    for item in EVIDENCE:
        item['url'] = f'https://github.com/petrkindlmann/qa-skills/blob/{BASE_COMMIT}/{item["source"]}'
        sources = [item['source'], *item.get('supportingSources', [])]
        item['sourceSha256'] = {source: hashlib.sha256((repo/source).read_bytes()).hexdigest()
                                for source in sources}
    manifest = {'title': "Green isn't correct.", 'format': 'drawn motion graphic',
                'baseTag': 'v3.4.0', 'baseCommit': BASE_COMMIT,
                'durationSeconds': DURATION, 'fps': FPS, 'frameCount': FRAME_COUNT,
                'evidence': EVIDENCE,
                'renderCommand': f'python3 scripts/render-green-lies.py --out {shlex.quote(str(out))}',
                'rendererSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'runtime': {'python': sys.version.split()[0], 'pillow': PILLOW_VERSION,
                            'ffmpeg': run(['ffmpeg', '-version'], capture_output=True,
                                          text=True).stdout.splitlines()[0],
                            'sansFont': str(font(34).path), 'monoFont': str(font(34, mono=True).path),
                            'symbolFont': str(symbol_font(34).path)},
                'layoutJump': checks['layoutJump'],
                'files': [{'path': p.name, 'bytes': p.stat().st_size,
                           'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
    (out/'provenance.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'output': str(out), 'verified': '15 s / 24 fps / H.264',
                      'gifBytes': gif.stat().st_size, 'reviewFrames': len(checks['frames'])}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    render(parser.parse_args().out)
