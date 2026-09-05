from __future__ import annotations

import base64
from pathlib import Path
from shutil import copy

import fitz

ROOT = Path(r"C:\Users\Nika TS\Desktop\Проекты\tabel")
ASSETS = ROOT / "src" / "assets"
PUBLIC = ROOT / "public"
FST_PUBLIC = ROOT / "fst-web" / "public"


def black_to_alpha_pixmap(pix: fitz.Pixmap, thr: int = 30) -> fitz.Pixmap:
    samples = bytearray(pix.samples)
    n = pix.n
    for i in range(0, len(samples), n):
        if max(samples[i], samples[i + 1], samples[i + 2]) < thr:
            samples[i + 3] = 0
    return fitz.Pixmap(pix.colorspace, pix.w, pix.h, samples, True)


def export_lockup(pdf_path: str, out_stem: Path, pad: float = 2.0, scale: float = 6.0) -> None:
    doc = fitz.open(pdf_path)
    page = doc[0]
    r = None
    for d in page.get_drawings():
        rect = d["rect"]
        r = rect if r is None else r | rect
    assert r is not None
    r = fitz.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad)
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, clip=r, alpha=True)
    pix = black_to_alpha_pixmap(pix)
    out = out_stem.with_suffix(".png")
    pix.save(str(out))
    print("lockup", out.name, pix.w, pix.h)


def export_mark(pdf_path: str, out: Path, scale: float = 8.0) -> tuple[int, int]:
    doc = fitz.open(pdf_path)
    page = doc[0]
    mark_rect = None
    for d in page.get_drawings():
        fill = d.get("fill")
        if fill and fill[0] > 0.8:
            mark_rect = d["rect"] if mark_rect is None else mark_rect | d["rect"]
    assert mark_rect is not None
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, clip=mark_rect, alpha=True)
    pix = black_to_alpha_pixmap(pix)
    pix.save(str(out))
    print("mark", out.name, pix.w, pix.h)
    return pix.w, pix.h


def write_favicon(mark_png: Path, w: int, h: int) -> None:
    b64 = base64.b64encode(mark_png.read_bytes()).decode("ascii")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}">\n'
        f'  <image href="data:image/png;base64,{b64}" width="{w}" height="{h}"/>\n'
        f"</svg>\n"
    )
    for folder in (PUBLIC, FST_PUBLIC):
        (folder / "fibercell-icon.svg").write_text(svg, encoding="utf-8")
        copy(mark_png, folder / "fibercell-icon.png")
    print("favicon updated", len(svg))


def main() -> None:
    export_lockup(
        r"c:\Users\Nika TS\Documents\FBcell\Fibercell new logo.pdf",
        ASSETS / "fibercell-logo-on-light",
    )
    export_lockup(
        r"c:\Users\Nika TS\Documents\FBcell\Fibercell new logo orange.pdf",
        ASSETS / "fibercell-logo-on-dark",
    )
    w, h = export_mark(
        r"c:\Users\Nika TS\Documents\FBcell\Fibercell new logo.pdf",
        ASSETS / "fibercell-mark.png",
    )
    write_favicon(ASSETS / "fibercell-mark.png", w, h)


if __name__ == "__main__":
    main()
