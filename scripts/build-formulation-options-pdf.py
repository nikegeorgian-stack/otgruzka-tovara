# -*- coding: utf-8 -*-
"""Generate formulation options PDF with diagrams for stakeholder review."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs"
IMG_DIR = OUT_DIR / "_formulation_pdf_assets"
PDF_PATH = OUT_DIR / "FORMULATION_RECIPE_OPTIONS.pdf"

FONT = r"C:\Windows\Fonts\arial.ttf"
FONT_B = r"C:\Windows\Fonts\arialbd.ttf"

# Brand-ish palette (FiberCell orange, not purple AI cliché)
ORANGE = (239, 101, 33)
ORANGE_SOFT = (255, 232, 220)
INK = (28, 25, 23)
MUTED = (87, 83, 78)
LINE = (214, 211, 209)
PAPER = (250, 250, 249)
WHITE = (255, 255, 255)
GREEN = (21, 128, 61)
AMBER = (180, 83, 9)
SKY = (3, 105, 161)
RED = (185, 28, 28)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def rounded_rect(draw: ImageDraw.ImageDraw, box, fill, outline=None, width=2, radius=14):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text_center(draw, xy, text, fnt, fill=INK):
    draw.text(xy, text, font=fnt, fill=fill, anchor="mm")


def make_cover_banner() -> Path:
    w, h = 1600, 520
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    # left accent bar
    d.rectangle((0, 0, 28, h), fill=ORANGE)
    # soft gradient-like bands
    for i, col in enumerate([(255, 247, 242), (255, 237, 227), (255, 247, 242)]):
        d.rectangle((40 + i * 40, 40, w - 40, 80 + i * 8), fill=col)
    rounded_rect(d, (60, 100, w - 60, 420), WHITE, ORANGE, 3, 24)
    text_center(d, (w // 2, 180), "FiberCell · Otgruzka", font(28, True), ORANGE)
    text_center(d, (w // 2, 250), "Рецептуры пропиточного состава", font(48, True), INK)
    text_center(d, (w // 2, 320), "Варианты упрощения — документ для выбора", font(30), MUTED)
    text_center(d, (w // 2, 380), "2026-07-28  ·  технолог · производство · IT", font(22), MUTED)
    path = IMG_DIR / "01_cover.png"
    im.save(path, "PNG")
    return path


def make_problem_diagram() -> Path:
    w, h = 1600, 720
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 40), "Проблема: слишком много ручных ячеек", font(34, True), INK)

    # Left card — overloaded
    rounded_rect(d, (50, 90, 760, 660), WHITE, RED, 3, 18)
    text_center(d, (405, 130), "Сейчас (перегруз)", font(28, True), RED)
    headers = ["Материал", "Склад", "Сухой кг", "Партия кг", "%", "Цена", "Остаток", "Расход"]
    y0 = 180
    for i, hname in enumerate(headers):
        x = 80 + (i % 4) * 160
        y = y0 + (i // 4) * 70
        rounded_rect(d, (x, y, x + 145, y + 52), ORANGE_SOFT if i >= 2 else (254, 226, 226), LINE, 1, 8)
        text_center(d, (x + 72, y + 26), hname, font(16, True), RED if i >= 2 else INK)
    d.text((90, 400), "Дубли и путаница:", font=font(20, True), fill=INK)
    for j, line in enumerate(
        [
            "• кг сухой и кг партии рядом",
            "• % вводят вручную",
            "• цена дублирует склад",
            "• остаток/расход — не для ввода",
        ]
    ):
        d.text((90, 450 + j * 40), line, font=font(20), fill=MUTED)

    # Right card — simple
    rounded_rect(d, (840, 90, 1550, 660), WHITE, GREEN, 3, 18)
    text_center(d, (1195, 130), "Цель (просто)", font(28, True), GREEN)
    simple = [("Материал склада", SKY), ("Кг в партии", ORANGE), ("% авто", MUTED), ("Цена со склада", MUTED)]
    for i, (label, col) in enumerate(simple):
        y = 190 + i * 85
        fill = (col[0], col[1], col[2],) if False else (
            ORANGE_SOFT if col == ORANGE else (224, 242, 254) if col == SKY else (245, 245, 244)
        )
        rounded_rect(d, (900, y, 1490, y + 68), fill, col, 2, 12)
        tag = "ВВОД" if i < 2 else "АВТО"
        text_center(d, (980, y + 34), tag, font(16, True), col)
        d.text((1060, y + 22), label, font=font(24, True), fill=INK)

    d.text((900, 560), "Миксер видит кг. Технолог — норму.\nСклад списывает однозначно.", font=font(20), fill=MUTED)

    path = IMG_DIR / "02_problem.png"
    im.save(path, "PNG")
    return path


def make_flow_diagram() -> Path:
    w, h = 1600, 520
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 36), "Цепочка: от рецепта до склада", font(32, True), INK)

    boxes = [
        (80, "Рецепт\nнорма кг", ORANGE),
        (420, "Задание\nмиксеру", SKY),
        (760, "Замес\nв кубе", AMBER),
        (1100, "Списание\nхимии", MUTED),
        (1440 - 220, "Приход\nпропитки", GREEN),
    ]
    for x, label, col in boxes:
        rounded_rect(d, (x, 140, x + 220, 320), WHITE, col, 3, 16)
        for i, line in enumerate(label.split("\n")):
            text_center(d, (x + 110, 210 + i * 36), line, font(24, True), INK)
    for i in range(4):
        x1 = boxes[i][0] + 220
        x2 = boxes[i + 1][0]
        mid = (x1 + x2) // 2
        d.line((x1 + 8, 230, x2 - 8, 230), fill=ORANGE, width=4)
        d.polygon([(x2 - 8, 230), (x2 - 22, 220), (x2 - 22, 240)], fill=ORANGE)

    text_center(
        d,
        (w // 2, 400),
        "QC (вязкость, температура) — отдельный журнал, не ячейки рецепта",
        font(22),
        MUTED,
    )
    path = IMG_DIR / "03_flow.png"
    im.save(path, "PNG")
    return path


def make_models_diagram() -> Path:
    w, h = 1600, 780
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 36), "Модели нормы состава", font(32, True), INK)

    cards = [
        ("A1 Куб / кг", "База 1000 кг\nстроки = кг", "Цех, миксер", ORANGE, True),
        ("A2 На 100 ч.", "Смола = 100\nостальное в частях", "Лаборатория", SKY, False),
        ("A3 % сухой", "Сумма сухих 100%\nвода отдельно", "Сравнение", AMBER, False),
        ("A4 2K A:B", "Фикс ratio\nзащита от брака", "Эпоксид/ПУ", GREEN, False),
        ("A5 Роли", "Смола / отверд.\n/ пигмент / вода", "Стандарт", MUTED, False),
        ("A6 Гибрид", "Партия ↔ 100 ч.\nдва языка", "Оба мира", (124, 58, 237), False),
    ]
    # avoid purple bias - change A6 to teal
    cards[5] = ("A6 Гибрид", "Партия ↔ 100 ч.\nдва языка", "Оба мира", (13, 148, 136), False)

    for i, (title, body, who, col, recommend) in enumerate(cards):
        col_i = i % 3
        row_i = i // 3
        x = 70 + col_i * 510
        y = 90 + row_i * 320
        rounded_rect(d, (x, y, x + 470, y + 280), WHITE, col, 3, 18)
        if recommend:
            rounded_rect(d, (x + 20, y + 18, x + 180, y + 52), ORANGE_SOFT, ORANGE, 1, 10)
            text_center(d, (x + 100, y + 35), "рекомендуем", font(16, True), ORANGE)
        text_center(d, (x + 235, y + 90), title, font(28, True), INK)
        for j, line in enumerate(body.split("\n")):
            text_center(d, (x + 235, y + 150 + j * 32), line, font(22), MUTED)
        text_center(d, (x + 235, y + 240), who, font(20, True), col)

    path = IMG_DIR / "04_models.png"
    im.save(path, "PNG")
    return path


def make_packages_chart() -> Path:
    w, h = 1600, 720
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 36), "Пакеты внедрения — сравнение", font(32, True), INK)

    # criteria radar-like as bar groups
    criteria = [
        ("Простота\nмиксера", [5, 5, 3, 3, 4]),
        ("Технолог", [3, 4, 5, 4, 4]),
        ("Защита\nот брака", [2, 3, 3, 5, 3]),
        ("Скорость\nвнедрения", [5, 3, 2, 3, 2]),
        ("Низкий\nриск данных", [5, 3, 2, 3, 2]),
    ]
    packages = ["α", "β", "γ", "δ", "ε"]
    pkg_colors = [ORANGE, GREEN, SKY, AMBER, MUTED]

    # legend
    lx = 80
    for i, (p, col) in enumerate(zip(packages, pkg_colors)):
        rounded_rect(d, (lx + i * 120, 70, lx + i * 120 + 90, 110), col, col, 1, 8)
        text_center(d, (lx + i * 120 + 45, 90), p, font(24, True), WHITE)

    chart_top = 160
    chart_bottom = 620
    chart_left = 200
    max_h = chart_bottom - chart_top
    group_w = 260
    bar_w = 36
    gap = 8

    for gi, (cname, scores) in enumerate(criteria):
        gx = chart_left + gi * group_w
        for j, line in enumerate(cname.split("\n")):
            text_center(d, (gx + group_w // 2 - 30, chart_bottom + 30 + j * 24), line, font(18), MUTED)
        for bi, score in enumerate(scores):
            bh = int(max_h * (score / 5))
            x = gx + bi * (bar_w + gap)
            y1 = chart_bottom - bh
            d.rectangle((x, y1, x + bar_w, chart_bottom), fill=pkg_colors[bi])
            text_center(d, (x + bar_w // 2, y1 - 16), str(score), font(16, True), INK)

    d.line((chart_left - 20, chart_bottom, chart_left + 5 * group_w - 40, chart_bottom), fill=LINE, width=2)
    text_center(d, (w // 2, 690), "Шкала 1–5. Выше столбец — лучше по критерию.", font(18), MUTED)

    path = IMG_DIR / "05_packages.png"
    im.save(path, "PNG")
    return path


def make_variants_diagram() -> Path:
    w, h = 1600, 620
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 36), "Цвет и граммовка: база + варианты", font(32, True), INK)

    # base
    rounded_rect(d, (560, 90, 1040, 260), WHITE, ORANGE, 3, 18)
    text_center(d, (800, 140), "Базовый рецепт", font(26, True), ORANGE)
    text_center(d, (800, 190), "химия без пигмента (или нейтраль)", font(20), MUTED)
    text_center(d, (800, 230), "смола · отвердитель · вода · …", font(20), INK)

    # arrow down
    d.line((800, 260, 800, 310), fill=ORANGE, width=4)
    d.polygon([(800, 330), (788, 310), (812, 310)], fill=ORANGE)

    colors_v = [
        ("Белый", (245, 245, 244), INK),
        ("Синий", (191, 219, 254), SKY),
        ("Оранж.", ORANGE_SOFT, ORANGE),
        ("Чёрный", (41, 37, 36), WHITE),
    ]
    for i, (name, fill, fg) in enumerate(colors_v):
        x = 120 + i * 370
        rounded_rect(d, (x, 360, x + 320, 540), fill, ORANGE if name == "Оранж." else LINE, 2, 14)
        text_center(d, (x + 160, 420), name, font(26, True), fg if name != "Чёрный" else WHITE)
        text_center(d, (x + 160, 470), "+ паста / этикетка", font(18), MUTED if name != "Чёрный" else (200, 200, 200))
        text_center(d, (x + 160, 505), "граммовка 145 / 160…", font(16), MUTED if name != "Чёрный" else (180, 180, 180))

    path = IMG_DIR / "06_variants.png"
    im.save(path, "PNG")
    return path


def make_roadmap() -> Path:
    w, h = 1600, 420
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 36), "Рекомендуемый путь", font(32, True), INK)

    steps = [
        ("1", "Пакет α", "Убрать лишний ввод\n%/цена/второй кг", ORANGE),
        ("2", "Пакет β", "Куб в кг +\nбаза и цвета", GREEN),
        ("3", "γ / δ / ε", "Только если\nнужна лаборатория/2K", MUTED),
    ]
    for i, (num, title, body, col) in enumerate(steps):
        x = 120 + i * 500
        rounded_rect(d, (x, 100, x + 420, 340), WHITE, col, 3, 18)
        d.ellipse((x + 30, 130, x + 90, 190), fill=col)
        text_center(d, (x + 60, 160), num, font(28, True), WHITE)
        text_center(d, (x + 240, 160), title, font(28, True), INK)
        for j, line in enumerate(body.split("\n")):
            text_center(d, (x + 210, 230 + j * 36), line, font(22), MUTED)
        if i < 2:
            d.line((x + 420, 220, x + 500, 220), fill=ORANGE, width=4)

    path = IMG_DIR / "07_roadmap.png"
    im.save(path, "PNG")
    return path


def build_pdf(images: dict[str, Path]) -> None:
    pdfmetrics.registerFont(TTFont("ArialRU", FONT))
    pdfmetrics.registerFont(TTFont("ArialRUB", FONT_B))

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="H1RU",
            fontName="ArialRUB",
            fontSize=18,
            leading=22,
            textColor=colors.HexColor("#1c1917"),
            spaceBefore=14,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H2RU",
            fontName="ArialRUB",
            fontSize=13,
            leading=17,
            textColor=colors.HexColor("#ef6521"),
            spaceBefore=10,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyRU",
            fontName="ArialRU",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#1c1917"),
            alignment=TA_JUSTIFY,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletRU",
            fontName="ArialRU",
            fontSize=10,
            leading=13,
            leftIndent=12,
            spaceAfter=2,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CenterRU",
            fontName="ArialRU",
            fontSize=10,
            leading=13,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#57534e"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="CaptionRU",
            fontName="ArialRU",
            fontSize=9,
            leading=11,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#78716c"),
            spaceBefore=4,
            spaceAfter=10,
        )
    )

    def img(path: Path, max_w=170 * mm):
        im = RLImage(str(path))
        im._restrictSize(max_w, 95 * mm)
        return im

    def bullets(items: list[str]):
        return ListFlowable(
            [ListItem(Paragraph(x, styles["BulletRU"]), leftIndent=8, bulletColor=colors.HexColor("#ef6521")) for x in items],
            bulletType="bullet",
            start="•",
        )

    story = []

    story.append(img(images["cover"], 180 * mm))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        "Документ для обсуждения и выбора подхода к рецептурам пропиточного состава в Otgruzka / FST. "
        "Код пока не меняли — сначала решение команды.",
        styles["BodyRU"],
    ))
    story.append(Paragraph(
        "Аудитория: технолог · производство · IT · руководство",
        styles["CenterRU"],
    ))

    story.append(PageBreak())
    story.append(Paragraph("1. Зачем этот документ", styles["H1RU"]))
    story.append(Paragraph(
        "В программе уже есть карточка рецептуры: состав, склад, замес, этикетка. "
        "На практике в карточке слишком много ручных ячеек, часть полей дублирует друг друга и Excel.",
        styles["BodyRU"],
    ))
    story.append(bullets([
        "выше риск ошибки (кг сухой / кг партии / % / цена);",
        "сложнее обучать миксера и нового технолога;",
        "непонятно, что норматив, а что справочная подсказка.",
    ]))
    story.append(Paragraph(
        "Нужно выбрать понятную модель рецепта и уровень простоты экрана, не ломая склад и замесы.",
        styles["BodyRU"],
    ))
    story.append(img(images["problem"]))
    story.append(Paragraph("Рис. 1. Сейчас — перегруз ввода; цель — мало полей, остальное автоматически.", styles["CaptionRU"]))

    story.append(Paragraph("2. Что уже хорошо в системе", styles["H1RU"]))
    story.append(bullets([
        "связь со складом и списанием при замесе;",
        "вода как особый компонент без склада;",
        "задания миксеру, куб, этикетка / внутренний код;",
        "подтягивание цен со склада.",
    ]))
    story.append(Paragraph(
        "Проблема не в отсутствии функций, а в перегрузе ввода.",
        styles["BodyRU"],
    ))
    story.append(img(images["flow"]))
    story.append(Paragraph("Рис. 2. Цепочка от рецепта до прихода готовой пропитки.", styles["CaptionRU"]))

    story.append(PageBreak())
    story.append(Paragraph("3. Что важно в производстве пропитки", styles["H1RU"]))
    story.append(Paragraph("Обязательный минимум", styles["H2RU"]))
    story.append(bullets([
        "состав по массе — что и сколько кг (или частей) на базу партии;",
        "жёсткие соотношения смола : отвердитель : ускоритель;",
        "база партии (например 800 кг сухого / 1000 кг с водой);",
        "вода / растворитель отдельно от складской химии;",
        "цвет / пигмент как вариант продукта;",
        "граммовка — связь с полотном и планом;",
        "себестоимость из цен склада, не ручной ввод в каждой строке.",
    ]))
    story.append(Paragraph("Нюансы", styles["H2RU"]))
    story.append(bullets([
        "соотношение отвердителя в паспортах фиксировано — нарушение даёт брак;",
        "считают по массе, не «на глаз»;",
        "вязкость и температура ванны — в QC-журнале, не в каждой ячейке рецепта;",
        "одна химия часто идёт в нескольких цветах — копировать весь рецепт неудобно.",
    ]))

    story.append(Paragraph("Ключевые формулы", styles["H2RU"]))
    formula_data = [
        [Paragraph("<b>Код</b>", styles["BodyRU"]), Paragraph("<b>Формула</b>", styles["BodyRU"]), Paragraph("<b>Зачем</b>", styles["BodyRU"])],
        ["F1", "Сумма кг строк", "Контроль базы партии"],
        ["F2", "% = кг / сухая_база × 100", "Автодоля без ручного ввода"],
        ["F3", "Масштаб на целевой объём", "Замес не ровно на 1000 кг"],
        ["F4", "Списание = кг без воды", "Склад"],
        ["F5", "Σ(кг × цена_склада)", "Себестоимость"],
        ["F6", "min(остаток/кг)", "Сколько партий хватит"],
        ["F7", "Проверка ratio A:B", "Защита 2K (опционально)"],
    ]
    t = Table(formula_data, colWidths=[18 * mm, 75 * mm, 70 * mm])
    t.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "ArialRU", 9),
                ("FONT", (0, 0), (-1, 0), "ArialRUB", 9),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ffe8dc")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d6d3d1")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 4 * mm))

    story.append(PageBreak())
    story.append(Paragraph("4. Модели нормы состава", styles["H1RU"]))
    story.append(Paragraph(
        "Можно комбинировать с типом экрана и схемой цветов. Ниже — шесть моделей.",
        styles["BodyRU"],
    ))
    story.append(img(images["models"]))
    story.append(Paragraph("Рис. 3. Модели A1–A6. Для цеха чаще всего достаточно A1.", styles["CaptionRU"]))

    story.append(Paragraph("Кратко по моделям", styles["H2RU"]))
    story.append(bullets([
        "<b>A1 Куб/кг</b> — база партии, в строках только кг. Понятно миксеру и складу.",
        "<b>A2 На 100 ч.</b> — как в ТУ/datasheet; нужен пересчёт на куб.",
        "<b>A3 %</b> — удобно сравнивать рецепты; воде — отдельная логика.",
        "<b>A4 2K</b> — фикс ratio смола/отвердитель, защита от брака.",
        "<b>A5 Роли</b> — стандартизация типов строк.",
        "<b>A6 Гибрид</b> — и партия, и «на 100»; дороже в поддержке.",
    ]))

    story.append(PageBreak())
    story.append(Paragraph("5. Плотность экрана и варианты продукта", styles["H1RU"]))
    story.append(Paragraph("Экраны", styles["H2RU"]))
    story.append(bullets([
        "<b>B1 Минимальный</b> — материал + кг; остальное авто снизу.",
        "<b>B2 Цеховой</b> — + база куба, вода, склад назначения.",
        "<b>B3 Технологический</b> — + роли и заметки; процесс/QC отдельно.",
        "<b>B4 Финансы на вкладке</b> — цены не в основной таблице.",
        "<b>B5 Excel-like, но read-only %</b> — быстрый безопасный шаг.",
        "<b>B6 Мастер 3 шага</b> — продукт → состав → склад/этикетка.",
    ]))
    story.append(Paragraph("Цвет и граммовка", styles["H2RU"]))
    story.append(img(images["variants"]))
    story.append(Paragraph("Рис. 4. Рекомендуемый подход: одна химия (база) + варианты цвета/граммовки.", styles["CaptionRU"]))
    story.append(bullets([
        "<b>C1</b> — отдельная карточка на каждый цвет (просто, много дублей);",
        "<b>C2</b> — база + варианты цвета (лучший баланс);",
        "<b>C3</b> — матрица граммовка × цвет;",
        "<b>C4</b> — наследование рецептов;",
        "<b>C5</b> — автоимя готовой пропитки на складе.",
    ]))

    story.append(PageBreak())
    story.append(Paragraph("6. Пакеты внедрения", styles["H1RU"]))
    story.append(Paragraph(
        "Пакет — готовая «сборка» для голосования, а не абстрактная идея.",
        styles["BodyRU"],
    ))
    story.append(img(images["packages"]))
    story.append(Paragraph("Рис. 5. Сравнение пакетов α–ε по ключевым критериям (1–5).", styles["CaptionRU"]))

    pkg_rows = [
        [Paragraph("<b>Пакет</b>", styles["BodyRU"]), Paragraph("<b>Суть</b>", styles["BodyRU"]), Paragraph("<b>Риск</b>", styles["BodyRU"])],
        ["α", "Убрать лишний ввод (%/цена/второй кг)", "Низкий"],
        ["β", "Куб в кг + простая шапка + база/цвета", "Средний"],
        ["γ", "Партия ↔ на 100 + матрица + финансы", "Выше"],
        ["δ", "Строгий 2K + роли", "Средний"],
        ["ε", "Импорт/нормализация из Excel в выбранный пакет", "Зависит"],
        ["ζ", "Только регламент без доработки UI", "Нет (но слабо)"],
    ]
    pt = Table(pkg_rows, colWidths=[18 * mm, 110 * mm, 35 * mm])
    pt.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "ArialRU", 9),
                ("FONT", (0, 0), (-1, 0), "ArialRUB", 9),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ffe8dc")),
                ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#ecfdf5")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d6d3d1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(pt)
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph("Строка β подсвечена — рекомендуемая цель после быстрого α.", styles["CaptionRU"]))

    story.append(PageBreak())
    story.append(Paragraph("7. Рекомендация и путь", styles["H1RU"]))
    story.append(img(images["roadmap"]))
    story.append(Paragraph("Рис. 6. Сначала α (быстро и безопасно), затем β (цеховая модель).", styles["CaptionRU"]))
    story.append(bullets([
        "Сейчас: пакет <b>α</b> — убрать ручной %/цену/двойной кг.",
        "Цель: пакет <b>β</b> — куб в кг + база и варианты цвета.",
        "γ / δ — только при явной потребности лаборатории или жёстких 2K.",
        "ε — после стабилизации β, если Excel ещё источник правды.",
        "ζ — не стратегия, максимум временная мера.",
    ]))

    story.append(Paragraph("Что не кладём в карточку рецепта", styles["H2RU"]))
    story.append(bullets([
        "результаты QC (вязкость, сухой остаток);",
        "температура и время жизни в ванне;",
        "простой оборудования и персонал смены;",
        "глубокий финансовый анализ маржи.",
    ]))
    story.append(Paragraph(
        "Рецепт = норматив состава + связь со складом и замесом. Процесс и QC — рядом.",
        styles["BodyRU"],
    ))

    story.append(Paragraph("8. Вопросы для совещания", styles["H1RU"]))
    story.append(bullets([
        "Кто главный пользователь карточки: технолог / миксер / оба?",
        "Норму удобнее как кг на куб или части на 100 смолы (или оба)?",
        "Цвета: отдельные рецепты или одна база + варианты?",
        "Нужен ли жёсткий контроль смола:отвердитель на всех рецептах?",
        "Сразу β или сначала только α?",
        "Excel ещё источник правды или уже архив?",
    ]))

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("9. Лист голосования", styles["H1RU"]))
    vote = [
        [Paragraph("<b>Участник</b>", styles["BodyRU"]), Paragraph("<b>Роль</b>", styles["BodyRU"]), Paragraph("<b>Пакет</b>", styles["BodyRU"]), Paragraph("<b>Комментарий</b>", styles["BodyRU"])],
        ["", "", "", ""],
        ["", "", "", ""],
        ["", "", "", ""],
        ["", "", "", ""],
    ]
    vt = Table(vote, colWidths=[40 * mm, 35 * mm, 25 * mm, 63 * mm], rowHeights=[8 * mm, 12 * mm, 12 * mm, 12 * mm, 12 * mm])
    vt.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "ArialRU", 9),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ffe8dc")),
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#a8a29e")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(vt)
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Итоговое решение: ________________________________", styles["BodyRU"]))
    story.append(Paragraph("Дата: ______________    Следующий шаг в IT: ______________________________", styles["BodyRU"]))
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(
        "Кратко: сейчас в рецептуре лишний ввод. Достаточно состава в кг, базы партии, воды отдельно, "
        "цвета/граммовки и авто-расчётов. Путь: α → β.",
        styles["BodyRU"],
    ))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("ArialRU", 8)
        canvas.setFillColor(colors.HexColor("#78716c"))
        canvas.drawString(18 * mm, 10 * mm, "FiberCell · Otgruzka · Рецептуры пропитки · для выбора")
        canvas.drawRightString(192 * mm, 10 * mm, f"стр. {doc.page}")
        canvas.setStrokeColor(colors.HexColor("#ef6521"))
        canvas.setLineWidth(1.5)
        canvas.line(18 * mm, 14 * mm, 192 * mm, 14 * mm)
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=18 * mm,
        title="Рецептуры пропиточного состава — варианты для выбора",
        author="FiberCell / Otgruzka",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print("PDF:", PDF_PATH)


def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    images = {
        "cover": make_cover_banner(),
        "problem": make_problem_diagram(),
        "flow": make_flow_diagram(),
        "models": make_models_diagram(),
        "packages": make_packages_chart(),
        "variants": make_variants_diagram(),
        "roadmap": make_roadmap(),
    }
    build_pdf(images)
    print("Images:", IMG_DIR)


if __name__ == "__main__":
    main()
