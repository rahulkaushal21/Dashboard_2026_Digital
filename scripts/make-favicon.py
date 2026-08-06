"""Composite the Mavlers mark onto the brand-yellow square so the favicon reads
on both a light and a dark browser tab strip.

The supplied mark is near-black on transparent. Tab strips follow the OS theme,
so on dark mode it sat on ~#1B1B1B and effectively vanished. Yellow (#FFDB2D,
tailwind mav.yellow) contrasts with light AND dark chrome, and the dark mark
contrasts with the yellow — so the icon reads either way.
"""
import sys
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE = 256
YELLOW = (255, 219, 45, 255)          # #FFDB2D — tailwind mav.yellow
PAD = 26                              # breathing room; the mark reads badly edge-to-edge at 16px

mark = Image.open(SRC).convert("RGBA")

# Trim to the mark's own bounding box first — the source has uneven internal
# padding, so centring the raw canvas would leave the logo visibly off-centre.
bbox = mark.getbbox()
if bbox:
    mark = mark.crop(bbox)

inner = SIZE - PAD * 2
w, h = mark.size
scale = min(inner / w, inner / h)
mark = mark.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

canvas = Image.new("RGBA", (SIZE, SIZE), YELLOW)
canvas.paste(mark, ((SIZE - mark.width) // 2, (SIZE - mark.height) // 2), mark)
canvas.save(OUT, "PNG", optimize=True)

print(f"wrote {OUT} {canvas.size} mark={mark.size} from bbox={bbox}")
