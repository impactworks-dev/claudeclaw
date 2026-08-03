from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path("/Users/dantecrescenzi/claudeclaw")
OUT = ROOT / "output" / "pdf" / "upwork-services"
LOGO = Path("/Users/dantecrescenzi/Downloads/impactworks-logo.png")

PRIMARY = HexColor("#023E8A")
SECONDARY = HexColor("#0077B6")
TERTIARY = HexColor("#ABD3FF")
PALE = HexColor("#EAF5FF")
PALE_2 = HexColor("#F6FAFE")
INK = HexColor("#102A43")
MUTED = HexColor("#486581")
LINE = HexColor("#C9E2F5")


SERVICES = [
    {
        "slug": "fractional-cmo-ai-strategy",
        "eyebrow": "FRACTIONAL LEADERSHIP + AI STRATEGY",
        "title": "Fractional CMO + AI Growth Strategy Sprint",
        "subtitle": "Turn scattered marketing activity into a focused growth system your team can execute.",
        "best_for": "Founders and leadership teams that need senior marketing direction, practical AI leverage, and an actionable 90-day plan.",
        "outcomes": [
            "Clear growth priorities tied to business goals",
            "A practical AI-enabled marketing operating model",
            "Focused channel, content, funnel, and measurement decisions",
        ],
        "steps": ["Discovery", "Growth diagnosis", "Strategy design", "Executive handoff"],
        "deliverables": [
            "Growth priorities and positioning recommendations",
            "AI and automation opportunity map",
            "90-day execution roadmap",
            "Leadership readout and decision guidance",
        ],
        "cta": "Move from marketing motion to a system built for growth.",
    },
    {
        "slug": "custom-ai-agent",
        "eyebrow": "AI AGENT STRATEGY + IMPLEMENTATION",
        "title": "Custom AI Agent for Your Business Workflow",
        "subtitle": "A purpose-built agent connected to the knowledge, tools, and actions your workflow requires.",
        "best_for": "Teams that want an AI agent for customer support, lead qualification, internal knowledge, scheduling, research, or productivity.",
        "outcomes": [
            "Agent behavior designed around a defined business outcome",
            "Guardrails, escalation paths, and human oversight",
            "Documented logic, integrations, testing, and handoff",
        ],
        "steps": ["Agent blueprint", "Build + connect", "Test + refine", "Launch + handoff"],
        "deliverables": [
            "Agent workflow and interaction design",
            "Prompt, tool, and knowledge configuration",
            "Integration and edge-case testing",
            "Usage documentation and implementation handoff",
        ],
        "cta": "Put AI to work on one workflow that matters.",
    },
    {
        "slug": "ai-automation-audit",
        "eyebrow": "IMPACTWORKS AUDITFLOW",
        "title": "AI Automation Audit + Prioritized Roadmap",
        "subtitle": "Identify where automation creates real leverage, what should remain human-led, and what to implement first.",
        "best_for": "Businesses with too many AI ideas, repetitive work, or disconnected systems that need a defensible starting point.",
        "outcomes": [
            "Current workflows mapped before solutions are prescribed",
            "Opportunities scored by impact, feasibility, effort, and risk",
            "A sequenced roadmap that leads into implementation",
        ],
        "steps": ["Workflow intake", "Opportunity scoring", "Roadmap design", "Executive readout"],
        "deliverables": [
            "Current-state workflow assessment",
            "Prioritized automation opportunity matrix",
            "Recommended solution approaches and guardrails",
            "Implementation roadmap and next actions",
        ],
        "cta": "Know where to automate before you start building.",
    },
    {
        "slug": "ai-business-automation",
        "eyebrow": "WORKFLOW AUTOMATION + DOCUMENTATION",
        "title": "Reliable AI Business Automation",
        "subtitle": "A tested workflow that connects your tools, applies business rules, handles exceptions, and reduces manual work.",
        "best_for": "Teams that need dependable automation for lead handling, approvals, documents, reporting, notifications, or internal operations.",
        "outcomes": [
            "A workflow designed around real triggers, data, and users",
            "Integrations, branching logic, guardrails, and error handling",
            "Testing and documentation so the system is maintainable",
        ],
        "steps": ["Map the workflow", "Build + integrate", "Test + refine", "Launch + document"],
        "deliverables": [
            "Configured end-to-end automation",
            "Connected systems and business-rule logic",
            "Functional and exception-path testing",
            "Operating documentation and ownership handoff",
        ],
        "cta": "Automate the work - without creating a black box.",
    },
]


def para(c, text, x, y, w, h, size=10, color=INK, leading=None, bold=False):
    style = ParagraphStyle(
        "p",
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading or size * 1.28,
        textColor=color,
        alignment=TA_LEFT,
        spaceAfter=0,
    )
    p = Paragraph(text, style)
    p.wrapOn(c, w, h)
    p.drawOn(c, x, y - p.height)
    return p.height


def round_box(c, x, y, w, h, fill, stroke=LINE, radius=12):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def draw_one(service):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"impactworks-{service['slug']}-one-pager.pdf"
    c = canvas.Canvas(str(path), pagesize=letter, pageCompression=1)
    W, H = letter

    c.setFillColor(white)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(PALE)
    c.rect(0, H - 226, W, 226, fill=1, stroke=0)
    c.setFillColor(TERTIARY)
    c.circle(W - 36, H - 22, 108, fill=1, stroke=0)
    c.setFillColor(HexColor("#D8ECFF"))
    c.circle(W - 4, H - 4, 72, fill=1, stroke=0)

    logo = ImageReader(str(LOGO))
    c.drawImage(logo, 42, H - 66, width=166, height=34, preserveAspectRatio=True, mask="auto")

    c.setFillColor(SECONDARY)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(42, H - 92, service["eyebrow"])
    title_h = para(c, service["title"], 42, H - 106, 500, 90, size=25, leading=28, bold=True, color=PRIMARY)
    para(c, service["subtitle"], 42, H - 111 - title_h, 500, 54, size=11.5, leading=15, color=MUTED)

    y_top = H - 252
    left_w = 345
    right_x = 410
    right_w = 160

    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(PRIMARY)
    c.drawString(42, y_top, "What this engagement delivers")
    y = y_top - 27
    for item in service["outcomes"]:
        c.setFillColor(SECONDARY)
        c.circle(49, y + 2, 4, fill=1, stroke=0)
        h = para(c, item, 62, y + 9, left_w - 20, 34, size=10, leading=13, color=INK)
        y -= max(28, h + 9)

    round_box(c, right_x, y_top - 106, right_w, 122, PALE_2)
    c.setFillColor(SECONDARY)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(right_x + 16, y_top - 10, "BEST FOR")
    para(c, service["best_for"], right_x + 16, y_top - 24, right_w - 32, 88, size=9, leading=12, color=INK)

    process_y = H - 412
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(PRIMARY)
    c.drawString(42, process_y, "How the work moves")
    line_y = process_y - 45
    c.setStrokeColor(LINE)
    c.setLineWidth(4)
    c.line(74, line_y, 536, line_y)
    x_positions = [76, 228, 380, 532]
    for idx, (x, label) in enumerate(zip(x_positions, service["steps"]), 1):
        c.setFillColor(PRIMARY if idx == 1 else SECONDARY)
        c.circle(x, line_y, 17, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(x, line_y - 3.5, str(idx))
        para(c, label, x - 58, line_y - 27, 116, 34, size=8.8, leading=11, color=INK, bold=True)

    deliv_y = H - 512
    round_box(c, 42, 118, 528, deliv_y - 118, PALE_2)
    c.setFillColor(PRIMARY)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(60, deliv_y - 26, "Core deliverables")
    y = deliv_y - 56
    for item in service["deliverables"]:
        c.setFillColor(SECONDARY)
        c.circle(68, y + 2, 6, fill=1, stroke=0)
        c.setFillColor(white)
        c.setLineWidth(1.5)
        c.line(65, y + 2, 67, y - 1)
        c.line(67, y - 1, 72, y + 5)
        para(c, item, 84, y + 10, 450, 28, size=9.5, leading=12, color=INK)
        y -= 30

    c.setFillColor(PRIMARY)
    c.rect(0, 0, W, 92, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(42, 58, service["cta"])
    c.setFont("Helvetica", 9)
    c.drawString(42, 36, "ImpactWorks | Fractional strategy, AI systems, and implementation")
    c.setFillColor(TERTIARY)
    c.roundRect(458, 28, 112, 38, 10, fill=1, stroke=0)
    c.setFillColor(PRIMARY)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(514, 43, "START A PROJECT")

    c.showPage()
    c.save()
    return path


if __name__ == "__main__":
    for service in SERVICES:
        print(draw_one(service))
