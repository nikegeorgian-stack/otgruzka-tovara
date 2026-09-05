# -*- coding: utf-8 -*-
"""PDF-инструкция по табелю для отделов (стиль FiberCell / Otgruzka)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image as RLImage,
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
OUT_DIR = ROOT / "docs" / "guides"
IMG_DIR = OUT_DIR / "_timesheet_guide_assets"
PDF_PATH = OUT_DIR / "TABEL_INSTRUKCIYA.pdf"
LOGO = ROOT / "src" / "assets" / "fibercell-logo-on-light.png"

FONT = r"C:\Windows\Fonts\arial.ttf"
FONT_B = r"C:\Windows\Fonts\arialbd.ttf"

ORANGE = (239, 101, 33)
ORANGE_SOFT = (255, 232, 220)
INK = (28, 25, 23)
MUTED = (87, 83, 78)
LINE = (214, 211, 209)
PAPER = (250, 248, 244)
WHITE = (255, 255, 255)
TEAL = (13, 148, 136)
SKY = (3, 105, 161)
GREEN = (21, 128, 61)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def rounded_rect(draw, box, fill, outline=None, width=2, radius=14):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text_center(draw, xy, text, fnt, fill=INK):
    draw.text(xy, text, font=fnt, fill=fill, anchor="mm")


def make_cover() -> Path:
    w, h = 1600, 560
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 28, h), fill=ORANGE)
    rounded_rect(d, (60, 70, w - 60, 490), WHITE, ORANGE, 3, 24)
    if LOGO.exists():
        logo = Image.open(LOGO).convert("RGBA")
        logo.thumbnail((280, 90))
        im.paste(logo, (90, 100), logo)
    text_center(d, (w // 2, 210), "Otgruzka · Табель", font(26, True), ORANGE)
    text_center(d, (w // 2, 280), "Инструкция для отделов", font(52, True), INK)
    text_center(
        d,
        (w // 2, 350),
        "План · Состав · Перекличка · Факт — простыми словами",
        font(28),
        MUTED,
    )
    text_center(d, (w // 2, 420), "FiberCell  ·  2026-07-29", font(22), MUTED)
    path = IMG_DIR / "01_cover.png"
    im.save(path, "PNG")
    return path


def make_flow_diagram() -> Path:
    w, h = 1600, 520
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 36), "Порядок работы на месяц", font(32, True), INK)
    steps = [
        ("1", "Состав", "Кто в бригаде"),
        ("2", "План", "График выходов"),
        ("3", "Перекличка", "Кто вышел сегодня"),
        ("4", "Факт", "Как было на деле"),
    ]
    box_w, box_h = 280, 200
    gap = 40
    total = len(steps) * box_w + (len(steps) - 1) * gap
    x0 = (w - total) // 2
    y = 100
    for i, (num, title, sub) in enumerate(steps):
        x = x0 + i * (box_w + gap)
        rounded_rect(d, (x, y, x + box_w, y + box_h), WHITE, ORANGE if i < 2 else TEAL, 3, 18)
        text_center(d, (x + box_w // 2, y + 48), num, font(40, True), ORANGE if i < 2 else TEAL)
        text_center(d, (x + box_w // 2, y + 110), title, font(30, True), INK)
        text_center(d, (x + box_w // 2, y + 155), sub, font(20), MUTED)
        if i < len(steps) - 1:
            ax = x + box_w + 8
            d.polygon(
                [(ax, y + box_h // 2 - 12), (ax + 24, y + box_h // 2), (ax, y + box_h // 2 + 12)],
                fill=LINE,
            )
    text_center(
        d,
        (w // 2, 380),
        "Сначала договорились, кто в бригаде и какой график — потом каждый день отмечаем явку.",
        font(22),
        MUTED,
    )
    text_center(
        d,
        (w // 2, 430),
        "План = «как должно быть». Факт = «как вышло». Расхождения подсвечиваются.",
        font(22),
        MUTED,
    )
    path = IMG_DIR / "02_flow.png"
    im.save(path, "PNG")
    return path


def make_screen_map() -> Path:
    w, h = 1600, 720
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 36), "Что где на экране табеля", font(32, True), INK)

    # Toolbar mock
    rounded_rect(d, (60, 80, 1540, 160), WHITE, LINE, 2, 12)
    d.rectangle((60, 80, 90, 160), fill=ORANGE)
    items = [
        (120, "Поиск"),
        (280, "График"),
        (440, "Факт | План"),
        (680, "Перекличка"),
        (920, "⛶ План"),
        (1120, "? коды"),
        (1280, "⋯ ещё"),
    ]
    for x, label in items:
        rounded_rect(d, (x, 105, x + 140, 140), ORANGE_SOFT if "Факт" in label or "Перек" in label else (245, 245, 244), LINE, 1, 8)
        text_center(d, (x + 70, 122), label, font(16, True), INK)

    # Tabs
    rounded_rect(d, (60, 180, 1540, 250), WHITE, LINE, 2, 12)
    for i, label in enumerate(["Все", "Бригада А", "Бригада Б", "+N список"]):
        x = 90 + i * 200
        fill = (240, 253, 250) if i == 0 else WHITE
        outline = TEAL if i == 0 else LINE
        rounded_rect(d, (x, 198, x + 170, 232), fill, outline, 2, 8)
        text_center(d, (x + 85, 215), label, font(16, True), TEAL if i == 0 else INK)

    # Table area
    rounded_rect(d, (60, 270, 1540, 660), WHITE, LINE, 2, 12)
    d.text((90, 295), "Таблица: ФИО слева, дни месяца сверху (1…31). Даты остаются видимыми при прокрутке.", font=font(20), fill=MUTED)
    # mini header days
    for day in range(1, 12):
        x = 360 + day * 70
        d.rectangle((x, 340, x + 60, 390), fill=ORANGE_SOFT if day in (6, 7) else (250, 248, 244), outline=LINE)
        text_center(d, (x + 30, 365), str(day), font(18, True), ORANGE if day in (6, 7) else INK)
    # rows
    for r, name in enumerate(["Иванов И.", "Петров П.", "Сидоров С."]):
        y = 420 + r * 70
        d.rectangle((90, y, 340, y + 55), fill=(250, 248, 244), outline=LINE)
        d.text((105, y + 16), name, font=font(18, True), fill=INK)
        for day in range(1, 12):
            x = 360 + day * 70
            code = "11" if day % 3 else "В"
            d.rectangle((x, y, x + 60, y + 55), fill=WHITE, outline=LINE)
            text_center(d, (x + 30, y + 27), code, font(16, True), TEAL if code != "В" else MUTED)

    path = IMG_DIR / "03_screen.png"
    im.save(path, "PNG")
    return path


def make_plan_fact_cards() -> Path:
    w, h = 1600, 520
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    text_center(d, (w // 2, 40), "Два режима: План и Факт", font(32, True), INK)

    rounded_rect(d, (80, 100, 740, 460), WHITE, SKY, 3, 18)
    text_center(d, (410, 150), "ПЛАН", font(36, True), SKY)
    lines_p = [
        "Что должно быть по графику",
        "Составляем до начала месяца",
        "Кнопка «План» сверху",
        "Состав → коды смен → Сохранить",
    ]
    for i, line in enumerate(lines_p):
        d.text((130, 210 + i * 50), f"•  {line}", font=font(22), fill=INK)

    rounded_rect(d, (860, 100, 1520, 460), WHITE, TEAL, 3, 18)
    text_center(d, (1190, 150), "ФАКТ", font(36, True), TEAL)
    lines_f = [
        "Что было на самом деле",
        "Заполняем каждый день",
        "Кнопка «Факт» + «Перекличка»",
        "Или клик по ячейке в таблице",
    ]
    for i, line in enumerate(lines_f):
        d.text((910, 210 + i * 50), f"•  {line}", font=font(22), fill=INK)

    path = IMG_DIR / "04_modes.png"
    im.save(path, "PNG")
    return path


def register_fonts():
    pdfmetrics.registerFont(TTFont("ArialRU", FONT))
    pdfmetrics.registerFont(TTFont("ArialRUB", FONT_B))


def styles_ru():
    base = getSampleStyleSheet()
    return {
        "H1RU": ParagraphStyle(
            "H1RU",
            parent=base["Heading1"],
            fontName="ArialRUB",
            fontSize=16,
            textColor=colors.HexColor("#1c1917"),
            spaceBefore=10,
            spaceAfter=6,
        ),
        "H2RU": ParagraphStyle(
            "H2RU",
            parent=base["Heading2"],
            fontName="ArialRUB",
            fontSize=12,
            textColor=colors.HexColor("#ef6521"),
            spaceBefore=8,
            spaceAfter=4,
        ),
        "BodyRU": ParagraphStyle(
            "BodyRU",
            parent=base["BodyText"],
            fontName="ArialRU",
            fontSize=10.5,
            leading=15,
            textColor=colors.HexColor("#292524"),
            spaceAfter=5,
            alignment=TA_LEFT,
        ),
        "CenterRU": ParagraphStyle(
            "CenterRU",
            parent=base["BodyText"],
            fontName="ArialRU",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#57534e"),
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "CaptionRU": ParagraphStyle(
            "CaptionRU",
            parent=base["BodyText"],
            fontName="ArialRU",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#78716c"),
            alignment=TA_CENTER,
            spaceBefore=2,
            spaceAfter=8,
        ),
        "TipRU": ParagraphStyle(
            "TipRU",
            parent=base["BodyText"],
            fontName="ArialRU",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#115e59"),
            backColor=colors.HexColor("#f0fdfa"),
            borderPadding=6,
            spaceBefore=4,
            spaceAfter=8,
        ),
        "StepRU": ParagraphStyle(
            "StepRU",
            parent=base["BodyText"],
            fontName="ArialRU",
            fontSize=10.5,
            leading=15,
            textColor=colors.HexColor("#1c1917"),
            leftIndent=4,
            spaceAfter=3,
        ),
    }


def bullets(items: list[str], style=None):
    st = style or ParagraphStyle(
        "BulletRU",
        fontName="ArialRU",
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#292524"),
    )
    return ListFlowable(
        [ListItem(Paragraph(x, st), leftIndent=8, bulletColor=colors.HexColor("#ef6521")) for x in items],
        bulletType="bullet",
        start="•",
        leftIndent=12,
        spaceAfter=6,
    )


def img(path: Path, width=170 * mm):
    return RLImage(str(path), width=width, height=width * Image.open(path).size[1] / Image.open(path).size[0])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#ef6521"))
    canvas.setLineWidth(2)
    canvas.line(18 * mm, A4[1] - 12 * mm, A4[0] - 18 * mm, A4[1] - 12 * mm)
    canvas.setFont("ArialRU", 8)
    canvas.setFillColor(colors.HexColor("#78716c"))
    canvas.drawString(18 * mm, 10 * mm, "FiberCell · Otgruzka · Инструкция по табелю")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"{doc.page}")
    canvas.restoreState()


def build():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    register_fonts()
    styles = styles_ru()

    images = {
        "cover": make_cover(),
        "flow": make_flow_diagram(),
        "screen": make_screen_map(),
        "modes": make_plan_fact_cards(),
    }

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        title="Инструкция по табелю — FiberCell Otgruzka",
        author="FiberCell",
    )

    story = []
    story.append(img(images["cover"], 174 * mm))
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "Краткая памятка для бригадиров, мастеров цеха и сотрудников, "
            "которые ведут табель в программе Otgruzka.",
            styles["CenterRU"],
        )
    )
    story.append(
        Paragraph(
            "Сайт: https://otgruzka-tovara.vercel.app &nbsp;·&nbsp; Данные общие — правки видят коллеги.",
            styles["CenterRU"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("1. С чего начать", styles["H1RU"]))
    story.append(
        Paragraph(
            "Откройте раздел <b>Табель</b> и выберите нужный месяц стрелками. "
            "Чтобы менять данные, нажмите кнопку <b>«Редактировать»</b> (если она доступна вашей роли).",
            styles["BodyRU"],
        )
    )
    story.append(bullets([
        "Сверху — поиск сотрудника, фильтр графика, переключатель <b>Факт | План</b>.",
        "Кнопка <b>«Перекличка»</b> — отметить явку за день (работает в режиме Факт).",
        "Вкладки бригад: <b>Все</b> или одна бригада. Кнопка <b>+N</b> открывает полный список с поиском.",
        "Знак <b>?</b> — подсказка по кодам. Даты дней при прокрутке списка остаются сверху.",
    ]))
    story.append(img(images["screen"]))
    story.append(Paragraph("Рис. 1. Основные элементы экрана табеля.", styles["CaptionRU"]))

    story.append(Paragraph("2. План и факт — в чём разница", styles["H1RU"]))
    story.append(img(images["modes"]))
    story.append(Paragraph("Рис. 2. Два режима одной таблицы.", styles["CaptionRU"]))
    story.append(
        Paragraph(
            "<b>План</b> — заранее: кто в какой день должен выйти. "
            "<b>Факт</b> — по итогам дня: кто реально вышел, кто в отпуске, больничном и т.д. "
            "Если факт совпадает с планом — менять ничего не нужно.",
            styles["BodyRU"],
        )
    )
    story.append(img(images["flow"]))
    story.append(Paragraph("Рис. 3. Рекомендуемый порядок: состав → план → перекличка → факт.", styles["CaptionRU"]))

    story.append(PageBreak())
    story.append(Paragraph("3. Как собрать состав бригады", styles["H1RU"]))
    story.append(
        Paragraph(
            "Состав — это список людей в строках бригады на выбранный месяц.",
            styles["BodyRU"],
        )
    )
    story.append(Paragraph("Шаги", styles["H2RU"]))
    story.append(bullets([
        "Выберите вкладку нужной бригады (не «Все»).",
        "Нажмите <b>«Состав»</b>.",
        "Отметьте сотрудников галочками.",
        "Быстрые кнопки: <b>«Из кадров»</b> — кто привязан к бригаде в карточках; "
        "<b>«С предыдущего месяца»</b> — те же люди, что были в этой бригаде в прошлом месяце.",
        "Нажмите <b>«Применить»</b>. План по графику пересчитается автоматически.",
    ]))
    story.append(
        Paragraph(
            "<b>Совет.</b> Берите состав «с предыдущего месяца» только для этой же бригады — "
            "так не попадут люди из чужих групп.",
            styles["TipRU"],
        )
    )

    story.append(Paragraph("4. Как сделать план", styles["H1RU"]))
    story.append(Paragraph("Вариант А — на листе", styles["H2RU"]))
    story.append(bullets([
        "Переключатель сверху поставьте на <b>«План»</b>.",
        "Нажмите <b>«Редактировать»</b> (если ещё не включено).",
        "Кликните по ячейке дня — выберите код смены (11, 8, В, ОТ…).",
        "Можно править сразу весь лист, не открывая отдельное окно.",
    ]))
    story.append(Paragraph("Вариант Б — большое окно плана", styles["H2RU"]))
    story.append(bullets([
        "В режиме «План» нажмите кнопку <b>⛶</b> (полноэкранный редактор).",
        "Меняйте коды кликами по дням.",
        "Обязательно нажмите <b>«Сохранить план»</b> — иначе правки не зафиксируются.",
        "В журнале видно, кто сохранял план и сколько ячеек изменил.",
    ]))
    story.append(
        Paragraph(
            "График часто заполняется сам из расписания сотрудника (5/2, 2/2…). "
            "Вручную правят исключения: отпуск, выходной, особая смена.",
            styles["BodyRU"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("5. Как сделать перекличку", styles["H1RU"]))
    story.append(
        Paragraph(
            "Перекличка — быстрый способ отметить явку <b>за один день</b> сразу по бригаде (или нескольким).",
            styles["BodyRU"],
        )
    )
    story.append(Paragraph("Шаги", styles["H2RU"]))
    story.append(bullets([
        "Переключатель поставьте на <b>«Факт»</b>.",
        "Нажмите <b>«Перекличка»</b>.",
        "Выберите дату (обычно сегодня).",
        "По каждому человеку: вышел / не вышел / код (как в плане, отпуск, больничный…).",
        "Можно поставить «как по плану» — скопировать код из плана в факт.",
        "Сохраните / примените отметки.",
    ]))
    story.append(
        Paragraph(
            "<b>Важно.</b> Кнопка «Перекличка» неактивна в режиме «План» — сначала переключитесь на «Факт».",
            styles["TipRU"],
        )
    )

    story.append(Paragraph("6. Как заполнить факт на листе", styles["H1RU"]))
    story.append(bullets([
        "Режим <b>«Факт»</b> + <b>«Редактировать»</b>.",
        "Клик по ячейке дня — тот же выбор кодов, что в перекличке.",
        "Есть пункт «как по плану» / «вышел» — когда человек отработал по графику.",
        "Меняйте только дни, где факт отличается от плана. Остальное можно не трогать.",
        "Расхождения плана и факта подсвечиваются — их удобно проверить перед закрытием месяца.",
    ]))

    story.append(Paragraph("7. Основные коды", styles["H1RU"]))
    code_rows = [
        [Paragraph("<b>Код</b>", styles["BodyRU"]), Paragraph("<b>Часы</b>", styles["BodyRU"]), Paragraph("<b>Простыми словами</b>", styles["BodyRU"])],
        ["4 / 6 / 8", "4–8", "Рабочий день (короткая / обычная смена)"],
        ["10 / 11 / 12", "10–12", "Смена 2/2 (типичные цеховые)"],
        ["Н", "11", "Ночная смена (+ надбавка)"],
        ["22", "22", "Сверхурочная / удлинённая отметка"],
        ["В", "0", "Выходной"],
        ["ОТ", "0", "Отпуск"],
        ["ОО", "0", "Отпуск без сохранения"],
        ["Б", "0", "Больничный"],
        ["X", "0", "Прогул / нарушение"],
        ["ПР", "0", "Простой"],
    ]
    t = Table(code_rows, colWidths=[28 * mm, 22 * mm, 120 * mm])
    t.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "ArialRU", 9),
                ("FONT", (0, 0), (-1, 0), "ArialRUB", 9),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ffe8dc")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d6d3d1")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafaf9")]),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            "Фиолетовые дни в шапке — праздники Грузии (часто автоматически «В»). "
            "Подробная легенка — кнопка «?» на экране.",
            styles["BodyRU"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("8. Частые вопросы", styles["H1RU"]))
    qa = [
        (
            "Не вижу своих бригад",
            "Откройте вкладку «Все» или «+N» и найдите бригаду поиском. "
            "У мастера цеха могут быть только «свои» бригады.",
        ),
        (
            "Пропал список при прокрутке — где даты?",
            "Прокручивайте таблицу внутри белой области: строка с числами дней закреплена сверху.",
        ),
        (
            "Нажал +9 — список не открывался",
            "Обновлённое меню показывает все бригады с поиском. Обновите страницу (Ctrl+F5).",
        ),
        (
            "Правки исчезли",
            "В большом редакторе плана нужно «Сохранить план». "
            "Данные общие в облаке — смотрите на прод-сайт, не на старую вкладку.",
        ),
        (
            "Можно ли править прошлый месяц?",
            "Если месяц не закрыт и у вас есть права — да. Закрытый месяц обычно только для просмотра.",
        ),
    ]
    for q, a in qa:
        story.append(Paragraph(q, styles["H2RU"]))
        story.append(Paragraph(a, styles["BodyRU"]))

    story.append(Paragraph("9. Мини-чеклист на месяц", styles["H1RU"]))
    story.append(bullets([
        "☐ Выбран правильный месяц",
        "☐ Включён режим «Редактировать»",
        "☐ Состав бригад проверен (или подтянут с прошлого месяца)",
        "☐ План сохранён",
        "☐ Каждый день: перекличка или правка факта",
        "☐ Перед зарплатой: нет лишних расхождений план/факт",
    ]))
    story.append(Spacer(1, 6 * mm))
    story.append(
        Paragraph(
            "Вопросы по правам доступа и закрытию месяца — к администратору / HR. "
            "Этот файл можно распечатать и положить у компьютера в отделе.",
            styles["CenterRU"],
        )
    )

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"OK: {PDF_PATH}")
    return PDF_PATH


if __name__ == "__main__":
    build()
