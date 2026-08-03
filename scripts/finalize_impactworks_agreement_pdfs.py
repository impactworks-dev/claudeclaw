from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "agreements"
TMP = ROOT / "tmp" / "agreements"

NAMES = [
    "ImpactWorks-Referral-Partnership-Agreement",
    "ImpactWorks-Venture-Partnership-Agreement",
    "ImpactWorks-Mutual-Non-Disclosure-Agreement",
]


def finalize(name: str) -> Path:
    cover_png = OUT / f"{name}-cover.png"
    cover_pdf = TMP / f"{name}-cover.pdf"
    body_pdf = TMP / f"{name}-body" / f"{name}.pdf"
    final_pdf = OUT / f"{name}.pdf"

    image = Image.open(cover_png).convert("RGB")
    image.save(cover_pdf, "PDF", resolution=300.0)

    body = PdfReader(body_pdf)
    cover = PdfReader(cover_pdf)
    writer = PdfWriter()
    writer.add_page(cover.pages[0])
    # The DOCX renderer reserves page one for the externally produced cover.
    for page in body.pages[1:]:
        writer.add_page(page)
    writer.add_metadata({
        "/Title": name.replace("-", " "),
        "/Author": "ImpactWorks",
        "/Subject": "Reusable agreement master",
    })
    with final_pdf.open("wb") as handle:
        writer.write(handle)
    return final_pdf


if __name__ == "__main__":
    for item in NAMES:
        print(finalize(item))
