/**
 * Inject coach.guide.* keys into en.ts / ka.ts from ru.ts.
 * Run: node scripts/gen-coach-i18n.mjs
 */
import fs from 'node:fs'

const ruSrc = fs.readFileSync('src/i18n/ru.ts', 'utf8')
const pairRe =
  /'((?:coach\.guide\.)[^']+)':\s*(?:\n\s*)?'((?:\\'|[^'])*)'/g
const pairs = []
let m
while ((m = pairRe.exec(ruSrc))) {
  pairs.push([m[1], m[2].replace(/\\'/g, "'")])
}
if (pairs.length < 20) {
  console.error('Too few keys from ru.ts:', pairs.length)
  process.exit(1)
}
console.log('parsed coach.guide keys:', pairs.length)

const enChrome = {
  'coach.guide.tabGuides': 'What I can show',
  'coach.guide.tabAsk': 'Ask in words',
  'coach.guide.search': 'Type what you want to do…',
  'coach.guide.listHint':
    'Pick a row and tap Start. I outline the button in red. Tap ONLY that — I will not advance myself.',
  'coach.guide.empty':
    'No guides here yet. Open another section on the left, then open «?» again.',
  'coach.guide.start': 'Start — point it out',
  'coach.guide.stepsShort': 'steps',
  'coach.guide.stepOf': 'Step {n} of {total}',
  'coach.guide.stop': 'Stop',
  'coach.guide.nowDo': 'Do this now:',
  'coach.guide.clickHint':
    '1) Find the red frame. 2) Click what is inside it. 3) Only then I show the next step. Do not touch other buttons.',
  'coach.guide.dontClickOther': 'There is no Next button — only the red frame.',
  'coach.guide.targetMissing':
    'I cannot see the button (menu closed or wrong tab). Open what the text asks, then tap Retry.',
  'coach.guide.retry': 'Retry',
  'coach.guide.done': 'Great! You clicked everything correctly. Guide finished.',
}

const kaChrome = {
  'coach.guide.tabGuides': 'რას გაჩვენებთ',
  'coach.guide.tabAsk': 'სიტყვებით',
  'coach.guide.search': 'დაწერეთ, რისი გაკეთება გინდათ…',
  'coach.guide.listHint':
    'აირჩიეთ სტრიქონი და დააჭირეთ «დაწყება». წითელ ჩარჩოში მოვნიშნავ ღილაკს. დააჭირეთ მხოლოდ მას.',
  'coach.guide.empty':
    'ამ განყოფილებაში ინსტრუქცია ჯერ არ არის. გახსენით სხვა განყოფილება მარცხნივ და ისევ «?».',
  'coach.guide.start': 'დაწყება — მაჩვენე',
  'coach.guide.stepsShort': 'ნაბიჯი',
  'coach.guide.stepOf': 'ნაბიჯი {n} / {total}',
  'coach.guide.stop': 'შეწყვეტა',
  'coach.guide.nowDo': 'ახლა გააკეთეთ ეს:',
  'coach.guide.clickHint':
    '1) იპოვეთ წითელი ჩარჩო. 2) დააჭირეთ იმას, რაც ჩარჩოშია. 3) მხოლოდ ამის შემდეგ გადავალ.',
  'coach.guide.dontClickOther': 'ღილაკი «შემდეგი» არ არის — მხოლოდ წითელი ჩარჩო.',
  'coach.guide.targetMissing':
    'ღილაკს ვერ ვხედავ. გახსენით რაც ტექსტშია და დააჭირეთ «ხელახლა».',
  'coach.guide.retry': 'ხელახლა',
  'coach.guide.done': 'შესანიშნავი! ყველაფერი სწორად დააჭირეთ. ინსტრუქცია დასრულდა.',
}

/** Полные переводы KA для ключей (иначе остаётся RU). */
const kaByKey = {
  'coach.guide.month.nightShift.title': 'ღამის ცვლა დღეზე',
  'coach.guide.month.nightShift.blurb': 'შეადგინე შემადგენლობა — ვინ ღამით და რატომ',
  'coach.guide.month.nightShift.s1.title': 'გახსენით მენიუ «სხვა»',
  'coach.guide.month.nightShift.s1.body':
    'ტაბელის თავში დააჭირეთ «სხვა» (⋯) — წითელი ჩარჩო. ამის გარეშე პუნქტი «ღამის ცვლა» სიაში არ ჩანს.',
  'coach.guide.month.nightShift.s2.title': 'აირჩიეთ «ღამის ცვლა»',
  'coach.guide.month.nightShift.s2.body':
    'სიაში დააჭირეთ «ღამის ცვლა» (წითელი ჩარჩო). გაიხსნება ფანჯარა არჩეულ დღეზე.',
  'coach.guide.month.nightShift.s3.title': 'დააჭირეთ «შეადგინე»',
  'coach.guide.month.nightShift.s3.body':
    'როგორც ბრიგადის შემადგენლობა გეგმაში: წითელი ჩარჩო «შეადგინე»-ზე. გაიხსნება სია მონიშვნებით.',
  'coach.guide.month.nightShift.s4.title': 'მონიშნეთ ადამიანები და დააჭირეთ «გამოყენება»',
  'coach.guide.month.nightShift.s4.body':
    'მონიშნეთ, ვინ რჩება ღამით. როცა შემადგენლობა მზადაა — დააჭირეთ «გამოყენება» (წითელი ჩარჩო). სია დაიხურება.',
  'coach.guide.month.nightShift.s5.title': 'დაწერეთ, რატომ ღამით',
  'coach.guide.month.nightShift.s5.body':
    'ყოველ მონიშნულ ადამიანს აქვს ველი «რატომ ღამით». დაწერეთ მიზეზი (გადაუდებელი შეკვეთა, ჩანაცვლება, ხაზი). თუ ერთი მიზეზია ყველასთვის — ქვემოთ ველი «საერთო მიზეზი».',
  'coach.guide.month.nightShift.s6.title': 'გაატარეთ დოკუმენტი',
  'coach.guide.month.nightShift.s6.body':
    'დააჭირეთ «გატარება · Н». ფაქტში მონიშნულებს ჩაეწერება Н, ღამის დანამატი შევა ხელფასში.',
  'coach.guide.feedback.report.title': 'შეცდომის შეტყობინება ან შეთავაზება',
  'coach.guide.feedback.report.blurb':
    'ღილაკი «!» რჩევების გვერდით → ტიპი → ტექსტი → ადმინისტრატორს და ჟურნალში',
  'coach.guide.feedback.report.s1.title': 'გახსენით ვიჯეტი «ანგარიში»',
  'coach.guide.feedback.report.s1.body':
    'ქვედა მარჯვნივ დააჭირეთ «!» (ანგარიში) წითელ ჩარჩოში — «?» ინსტრუქტორის გვერდით. გაიხსნება უკუკავშირის ფანჯარა. შეტყობინება მივა სისტემურ ადმინისტრატორს და შეინახება ჟურნალში.',
  'coach.guide.feedback.report.s2.title': 'აირჩიეთ ტიპი: შეცდომა ან შეთავაზება',
  'coach.guide.feedback.report.s2.body':
    'წითელ ჩარჩოში გადართეთ «შეცდომა» (პროგრამის ბაგი) ან «შეთავაზება» (გაუმჯობესების იდეა). ასე ადმინისტრატორი სწრაფად მიხვდება სისწრაფეს.',
  'coach.guide.feedback.report.s3.title': 'აღწერეთ სიტუაცია',
  'coach.guide.feedback.report.s3.body':
    'აღწერის ველში (წითელი ჩარჩო) დაწერეთ: რა გააკეთეთ, რას ელოდით და რა მოხდა (შეცდომისთვის) — ან რა გინდათ გაუმჯობესება (შეთავაზებისთვის). ზემოთ შეგიძლიათ მოკლე სათაური.',
  'coach.guide.feedback.report.s4.title': 'გაგზავნეთ ადმინისტრატორთან',
  'coach.guide.feedback.report.s4.body':
    'დააჭირეთ «გაგზავნა ადმინისტრატორთან» წითელ ჩარჩოში. ჩანაწერი გამოჩნდება ჟურნალში (პარამეტრები / sysadmin-ის ზარი); ადმინი მიიღებს შეტყობინებას და შეცვლის სტატუსს: ახალი → ნანახი → დახურული.',
  'coach.guide.procurement.orders.title': 'მომწოდებლის შეკვეთები',
  'coach.guide.procurement.orders.blurb': 'ჟურნალი → ახალი შეკვეთა → მომწოდებელი → შენახვა',
  'coach.guide.procurement.orders.s2.title': 'ახალი შეკვეთა მომწოდებელთან',
  'coach.guide.procurement.orders.s2.body':
    'დააჭირეთ ახალი შეკვეთის ღილაკს (წითელი ჩარჩო). გაიხსნება შეკვეთის ფანჯარა — შემდეგ ავირჩევთ მომწოდებელს.',
  'coach.guide.procurement.orders.s3.title': 'მომწოდებელი ფანჯარაში',
  'coach.guide.procurement.orders.s3.body':
    'წითელ ჩარჩოში — მომწოდებლის არჩევა კონტრაგენტების ჟურნალიდან. შეგიძლიათ ძებნა სახელით ან კოდით.',
  'coach.guide.procurement.orders.s4.title': 'ახალი მომწოდებელი',
  'coach.guide.procurement.orders.s4.body':
    'თუ მომწოდებელი ჯერ არ არის — დააჭირეთ «+ ახალი მომწოდებელი» წითელ ჩარჩოში და შეავსეთ ბარათი პირდაპირ შეკვეთიდან.',
  'coach.guide.procurement.orders.s5.title': 'შეინახეთ შეკვეთა',
  'coach.guide.procurement.orders.s5.body':
    'დაამატეთ პოზიციები და დააჭირეთ «შენახვა» წითელ ჩარჩოში ფანჯრის ქვემოთ. შეკვეთა გამოჩნდება შესყიდვების ჟურნალში.',
  'coach.guide.hr.anketa.s3.title': 'შეავსეთ პასუხები ფანჯარაში',
  'coach.guide.hr.anketa.s3.body':
    'გახსნილ ანკეტაში (წითელი ჩარჩო) დასვით კითხვები კანდიდატს ხმამაღლა და ჩაწერეთ პასუხები ველებში. კითხვის ტექსტის რედაქტირება შეიძლება.',
  'coach.guide.hr.anketa.s4.title': 'საკუთარი კითხვა',
  'coach.guide.hr.anketa.s4.body':
    'საჭიროა დამატებითი კითხვა? დააჭირეთ «საკუთარი კითხვის დამატება» წითელ ჩარჩოში სიის ქვემოთ.',
  'coach.guide.hr.anketa.s5.title': 'შეინახეთ ანკეტა',
  'coach.guide.hr.anketa.s5.body':
    'დააჭირეთ «შენახვა» წითელ ჩარჩოში — ანკეტა დარჩება კანდიდატთან ჟურნალში.',
  'coach.guide.hr.anketa.s6.title': 'ბლანკის ბეჭდვა',
  'coach.guide.hr.anketa.s6.body':
    'სურვილისამებრ დააჭირეთ «ბეჭდვა» წითელ ჩარჩოში — ქაღალდზე გადავა მხოლოდ ანკეტის ბლანკი, პროგრამის მენიუს გარეშე.',
  'coach.guide.hr.addEmployee.s3.title': 'შეინახეთ ბარათი',
  'coach.guide.hr.addEmployee.s3.body':
    'გახსნილ ფანჯარაში შეავსეთ სავალდებულო ველები და დააჭირეთ «შენახვა» წითელ ჩარჩოში ქვემოთ. ამის შემდეგ თანამშრომელი გამოჩნდება სიაში.',
  'coach.guide.director.newOrder.s3.title': 'აირჩიეთ დამკვეთი',
  'coach.guide.director.newOrder.s3.body':
    'წითელ ჩარჩოში — ველი «დამკვეთი». აირჩიეთ სიიდან ან შემდეგ ნაბიჯზე დაამატეთ ახალი.',
  'coach.guide.director.newOrder.s4.title': 'ახალი დამკვეთი',
  'coach.guide.director.newOrder.s4.body':
    'თუ კლიენტი ჯერ არ არის — დააჭირეთ «+ ახალი დამკვეთი» წითელ ჩარჩოში, შეიყვანეთ სახელი და დაამატეთ. ის მაშინვე შევა შეკვეთასა და კონტრაგენტების ჟურნალში.',
  'coach.guide.director.newOrder.s5.title': 'შეინახეთ შეკვეთა',
  'coach.guide.director.newOrder.s5.body':
    'შეავსეთ შეკვეთის პოზიციები და დააჭირეთ «შენახვა» წითელ ჩარჩოში. შეკვეთა გამოჩნდება შეკვეთების ჟურნალში.',
  'coach.guide.hr.candidates.title': 'კანდიდატები: სია და ახალი',
  'coach.guide.hr.candidates.blurb': 'კანდიდატების ჩანართი → ახალი ადამიანის დამატება',
  'coach.guide.hr.candidates.s2.title': 'კანდიდატის დამატება',
  'coach.guide.hr.candidates.s2.body':
    'დააჭირეთ კანდიდატის დამატების ღილაკს წითელ ჩარჩოში. შეავსეთ სახელი და ძირითადი მონაცემები — გამოჩნდება სიაში. შემდეგ შეგიძლიათ ანკეტა.',
  'coach.guide.mixer.tasks.title': 'დავალებით შერევა',
  'coach.guide.mixer.tasks.blurb': 'შემოსული დავალებები → პანელი → ჩატარება',
  'coach.guide.mixer.tasks.s2.title': 'შერევის პანელი',
  'coach.guide.mixer.tasks.s2.body':
    'სიის ქვემოთ — შერევის პანელი წითელ ჩარჩოში. შეამოწმეთ რეცეპტი, მოცულობა და საწყობი.',
  'coach.guide.mixer.tasks.s3.title': 'შერევის ჩატარება',
  'coach.guide.mixer.tasks.s3.body':
    'როცა მზადაა — დააჭირეთ შერევის ჩატარების ღილაკს წითელ ჩარჩოში. დავალება დაიხურება, შეიძლება ეტიკეტის ბეჭდვა.',
  'coach.guide.journals.open.s1.title': 'ჟურნალის კატეგორიები',
  'coach.guide.journals.open.s1.body':
    'დააჭირეთ კატეგორიის ფილებს წითელ ჩარჩოში — ასე ფილტრავთ მოვლენებს.',
  'coach.guide.journals.open.s2.title': 'ჟურნალის ფილტრები',
  'coach.guide.journals.open.s2.body':
    'ქვემოთ ფილტრებია: ძებნა, ავტორი, სტატუსი, პერიოდი. ჟურნალი აჩვენებს ვინ რა შეცვალა.',
  'coach.guide.directories.open.s2.title': 'ჩანართი «დამკვეთები»',
  'coach.guide.directories.open.s2.body':
    'დააჭირეთ დამკვეთების/კონტრაგენტების ჩანართს წითელ ჩარჩოში. აქ იწყება კლიენტები და მომწოდებლები.',
  'coach.guide.directories.payAccrual.title': 'ხელფასის დარიცხვები',
  'coach.guide.directories.payAccrual.blurb':
    'ღამის, უქმის, ზეგანაკვეთურის კოეფიციენტები და ხაზის ღამის ფიქსი',
  'coach.guide.directories.payAccrual.s1.title': 'ჩანართი «დარიცხვები»',
  'coach.guide.directories.payAccrual.s1.body':
    'ზემოთ იპოვეთ ჩანართი «დარიცხვები» წითელ ჩარჩოში და დააჭირეთ. თუ უკვე გახსნილია — დააჭირეთ კიდევ, რომ გავიგო მზად ხართ.',
  'coach.guide.directories.payAccrual.s2.title': 'ხაზის ღამის ფიქსი',
  'coach.guide.directories.payAccrual.s2.body':
    'ცხრილში იპოვეთ სტრიქონი «ხაზის ღამე» წითელ ჩარჩოში. ეს არის ფიქსირებული 20 ₾ ყოველ ღამის ცვლაზე გაჟღენთაზე — საათების +25%-ის გარდა. თანხის შეცვლა და შენახვა შეიძლება.',
}

function ruToKa(s, key) {
  if (kaByKey[key]) return kaByKey[key]
  return s
}

function ruToEn(s) {
  const map = [
    ['Ночная смена на день', 'Night shift for the day'],
    ['Составь состав — галочки кто ночью и почему', 'Compose the roster — tick who works nights and why'],
    ['Выберите «Ночная смена»', 'Choose Night shift'],
    ['Нажмите «Составь»', 'Press Compose'],
    ['Отметьте людей и нажмите «Применить»', 'Tick people and press Apply'],
    ['Напишите, почему ночью', 'Write why they work at night'],
    ['Проведите документ', 'Post the document'],
    [
      'В шапке табеля нажмите «Ещё» (⋯) — красная рамка. Без этого пункта «Ночная смена» в списке не видно.',
      'In the timesheet header tap More (⋯) — red frame. Without that, Night shift is not in the list.',
    ],
    [
      'В списке нажмите «Ночная смена» (красная рамка). Откроется окно на выбранный день.',
      'In the list tap Night shift (red frame). The day window opens.',
    ],
    [
      'Как состав бригады в плане: красная рамка на «Составь». Откроется список людей с галочками.',
      'Same as brigade roster in the plan: red frame on Compose. A checklist of people opens.',
    ],
    [
      'Галочками отметьте, кто остаётся на ночь. Когда состав готов — нажмите «Применить» (красная рамка). Список закроется.',
      'Tick who stays for the night. When the roster is ready, tap Apply (red frame). The list closes.',
    ],
    [
      'У каждого отмеченного человека есть строка «почему ночью». Напишите причину (срочный заказ, подмена, линия). Если причина одна на всех — поле «Общая причина» внизу окна.',
      'Each ticked person has a Why at night line. Write the reason (urgent order, cover, line). If one reason for everyone — Shared reason at the bottom.',
    ],
    [
      'Нажмите «Провести · поставить Н». В факте выбранным проставится код Н, ночная надбавка пойдёт в расчёт ЗП.',
      'Tap Post · set Н. Actual gets code N for the selected people; the night bonus goes into payroll.',
    ],
    ['Проставить факт в ячейке', 'Enter actual in a cell'],
    ['Включить правку, открыть факт и кликнуть ячейку', 'Enable edit, open Actual, click a cell'],
    ['Включите редактирование', 'Turn on editing'],
    ['Нажмите кнопку правки в шапке табеля.', 'Tap the edit button in the timesheet header.'],
    ['Вкладка «Факт»', 'Actual tab'],
    ['Переключитесь на факт — туда вносят реальные выходы.', 'Switch to Actual — real attendance goes there.'],
    ['Кликните ячейку', 'Click a cell'],
    ['Выберите день сотрудника и задайте код смены.', 'Pick an employee day and set the shift code.'],
    ['План и факт', 'Plan and actual'],
    ['Переключение вкладок плана и факта', 'Switch between Plan and Actual tabs'],
    ['Откройте план', 'Open Plan'],
    ['Нажмите вкладку «План».', 'Tap the Plan tab.'],
    ['Откройте факт', 'Open Actual'],
    ['Нажмите вкладку «Факт».', 'Tap the Actual tab.'],
    ['Перекличка', 'Roll call'],
    ['Отметить присутствующих за день', 'Mark who is present for the day'],
    ['Меню «Ещё»', 'More menu'],
    ['Откройте меню дополнительных действий.', 'Open the extra actions menu.'],
    ['Выберите пункт «Перекличка».', 'Choose Roll call.'],
    ['Перевод в бригаду', 'Transfer to brigade'],
    ['Перевести сотрудника с даты', 'Transfer an employee from a date'],
    ['Выберите «Перевод в бригаду».', 'Choose Transfer to brigade.'],
    ['Печать табеля', 'Print timesheet'],
    ['Распечатать лист месяца', 'Print the month sheet'],
    ['Выберите «Печать».', 'Choose Print.'],
    ['Редактор плана', 'Plan editor'],
    ['Открыть полноэкранный редактор плана', 'Open the full-screen plan editor'],
    ['Нажмите кнопку редактора плана в шапке.', 'Tap the plan editor button in the header.'],
    ['Подмена мастера', 'Master coverage'],
    ['Фильтр «мои / замещаемый / все»', 'Filter my / covered / all brigades'],
    ['Переключатель бригад', 'Brigade switch'],
    ['Нажмите нужный режим на панели подмены.', 'Tap the mode on the coverage bar.'],
    ['Добавить сотрудника', 'Add employee'],
    ['Открыть карточку нового сотрудника', 'Open a new employee card'],
    ['Нажмите «Добавить».', 'Tap Add.'],
    ['Ведомость и выгрузка 1С', 'Statement and 1C export'],
    ['Открыть выгрузку Salary Calculation', 'Open Salary Calculation export'],
    ['Нажмите выгрузку 1С (Salary Calculation).', 'Tap the 1C (Salary Calculation) export.'],
    ['Новая заявка на складе', 'New warehouse request'],
    ['Создать движение / заявку', 'Create a movement / request'],
    ['Нажмите создание заявки.', 'Tap create request.'],
    ['Производственная заявка', 'Production request'],
    ['Создать сменную заявку', 'Create a shift request'],
    ['Нажмите новую заявку.', 'Tap new request.'],
    ['Производственный заказ', 'Production order'],
    ['Создать заказ планировщика', 'Create a planner order'],
    ['Нажмите новый заказ.', 'Tap new order.'],
    ['Заказ клиента', 'Customer order'],
    ['Создать заказ в дирекции', 'Create an order in sales'],
    ['Нажмите новый заказ клиента.', 'Tap new customer order.'],
    ['Закупка', 'Procurement'],
    ['Создать документ закупки', 'Create a purchase document'],
    ['Нажмите новую закупку.', 'Tap new purchase.'],
    ['Технолог', 'Technologist'],
    ['Открыть раздел контроля качества', 'Open quality control'],
    ['Нажмите нужную вкладку технолога.', 'Tap the technologist tab you need.'],
    ['Задания миксеру', 'Mixer tasks'],
    ['Открыть входящие задания', 'Open inbox tasks'],
    ['Нажмите блок входящих заданий.', 'Tap the inbox block.'],
    ['Справочники', 'Directories'],
    ['Открыть нужный справочник', 'Open the directory you need'],
    ['Выберите вкладку справочника.', 'Pick a directory tab.'],
    ['Журналы', 'Journals'],
    ['Настроить фильтры журнала', 'Set journal filters'],
    ['Нажмите область фильтров.', 'Tap the filters area.'],
    ['Настройки доступа', 'Access settings'],
    ['Открыть роли и права', 'Open roles and permissions'],
    ['Нажмите блок доступа.', 'Tap the access block.'],
    ['Сводка', 'Summary'],
    ['Открыть сводную таблицу', 'Open the summary table'],
    ['Нажмите таблицу сводки.', 'Tap the summary table.'],
    ['Мой кабинет', 'My cabinet'],
    ['Открыть личные данные', 'Open personal data'],
    ['Нажмите панель кабинета.', 'Tap the cabinet panel.'],
    ['Сообщить об ошибке или предложить', 'Report a bug or suggest an idea'],
    [
      'Кнопка «!» рядом с подсказками → тип → текст → отправка администратору и в журнал',
      'The «!» button next to help → type → text → send to admin and journal',
    ],
    ['Откройте виджет «Отчёт»', 'Open the Report widget'],
    [
      'Внизу справа нажмите кнопку «!» (Отчёт) в красной рамке — рядом с инструктором «?». Откроется окно обратной связи. Сообщение уйдёт системному администратору и сохранится в журнале.',
      'Bottom-right: tap «!» (Report) in the red frame — next to the «?» instructor. A feedback window opens. The message goes to the system administrator and is saved in the journal.',
    ],
    ['Выберите тип: ошибка или предложение', 'Choose type: bug or suggestion'],
    [
      'В красной рамке переключите «Ошибка» (баг в программе) или «Предложение» (идея улучшить работу). Это помогает администратору сразу понять срочность.',
      'In the red frame switch Bug (app problem) or Suggestion (improvement idea). This helps the admin see urgency at once.',
    ],
    ['Опишите ситуацию', 'Describe the situation'],
    [
      'В поле описания в красной рамке напишите: что делали, что ожидали и что произошло (для ошибки) — или что хотите улучшить (для предложения). Можно добавить короткий заголовок сверху.',
      'In the description field (red frame) write what you did, expected, and what happened (for a bug) — or what to improve (for a suggestion). You may add a short title above.',
    ],
    ['Отправьте администратору', 'Send to the administrator'],
    [
      'Нажмите «Отправить администратору» в красной рамке. Запись появится в журнале (Настройки / колокольчик у sysadmin), администратор увидит всплывающее уведомление и сможет отметить статус: новое → просмотрено → закрыто.',
      'Tap «Send to administrator» in the red frame. The entry appears in the journal (Settings / sysadmin bell); the admin gets a toast and can set status: new → seen → closed.',
    ],
    [
      'На складе нажмите «Остатки» в красной рамке. Откроется таблица материалов и готовой продукции с количеством «сейчас». Можно искать по названию. Если нужно движение — потом откройте вкладку прихода/расхода или документ из журнала. Остатки не правят вручную: они меняются документами.',
      'In Warehouse tap Balances in the red frame. You get a table of materials and finished goods with current qty. Search by name if needed. For movements open Incoming/Outgoing or a journal document. Do not edit balances by hand — documents change them.',
    ],
    [
      'Нажмите вкладку прихода/расхода (движения) в красной рамке. Здесь список операций и кнопка нового документа. В окне документа укажите склад, позиции, количество и сохраните — остатки пересчитаются сами. Ошибочный документ лучше сторнировать/исправить, а не править остаток «на глаз».',
      'Tap Incoming/Outgoing (movements) in the red frame. You see operations and a new-document button. In the document window set warehouse, lines, qty and save — balances recalculate. Fix wrong docs; do not tweak stock “by eye”.',
    ],
    [
      'Нажмите «Документы» склада в красной рамке. Это журнал накладных и складских документов. Клик по строке открывает окно документа: можно проверить позиции, даты, автора. Отсюда удобно искать «кто провёл» и печатать при необходимости.',
      'Tap Warehouse Documents in the red frame — the journal of slips. Click a row to open the document window: lines, dates, author. Use it to see who posted and to print.',
    ],
    [
      'Нажмите «Инвентаризация» в красной рамке. Создайте или откройте акт: внесите фактические количества с полок. После проведения программа покажет расхождения с учётными остатками. Делайте инвентаризацию спокойно, без параллельных движений по тем же позициям.',
      'Tap Inventory in the red frame. Create or open a count sheet and enter shelf quantities. After posting, the app shows gaps vs book stock. Avoid parallel movements on the same items during the count.',
    ],
    [
      'Нажмите «Погрузка» в красной рамке. Здесь план отгрузки: какие позиции и на какую дату/рейс. Откройте нужную строку или создайте новую — в окне укажите заказ/клиент и состав. Это связка склада с отгрузкой, не путать с обычным расходом «с полки».',
      'Tap Loading in the red frame — the shipping plan (what and when). Open or create a row; in the window set order/customer and lines. This links warehouse to shipment — not the same as a plain stock issue.',
    ],
    [
      'В Производстве нажмите вкладку сменной заявки в красной рамке. Создайте новую или откройте существующую — в окне заявки укажите смену, позиции и объёмы. После сохранения заявка видна мастерам/смене. Не путать с производственным заказом планировщика: заявка — на смену, заказ — на план производства.',
      'In Production tap the shift request tab (red frame). Create or open one; in the window set shift, lines and volumes. After save, masters/shift see it. Not the same as a planner production order: request = shift, order = production plan.',
    ],
    [
      'В Планировщике нажмите вкладку заказов в красной рамке — увидите список производственных заказов (статусы, сроки, объёмы).',
      'In Planner tap the orders tab (red frame) — production orders with status, dates and volumes.',
    ],
    [
      'Нажмите «Новый заказ» (красная рамка). В открывшемся окне заполните продукцию, количество, сроки и связанные данные, затем сохраните. Заказ потом питает сменные заявки и задания миксеру — поэтому сроки и объёмы лучше сразу проверить.',
      'Tap New order (red frame). In the window fill product, qty, dates and related fields, then save. The order feeds shift requests and mixer tasks — check dates and volumes carefully.',
    ],
    ['Кандидаты: список и новый', 'Candidates: list and new'],
    [
      'Вкладка кандидатов → добавить нового человека на отбор',
      'Candidates tab → add a person for hiring',
    ],
    ['Добавить кандидата', 'Add candidate'],
    [
      'Нажмите кнопку добавления кандидата в красной рамке. Заполните ФИО и основные данные — человек появится в списке. Потом можно открыть анкету.',
      'Tap Add candidate in the red frame. Fill name and basics — they appear in the list. Then you can open the questionnaire.',
    ],
    ['Замесить по заданию', 'Mix from a task'],
    [
      'Входящие задания → панель замеса → провести замес',
      'Inbox tasks → mix panel → post the mix',
    ],
    ['Панель замеса', 'Mix panel'],
    [
      'Ниже списка — панель замеса в красной рамке. Проверьте рецепт, объём и склад. При выбранном задании поля подставятся сами.',
      'Below the list — mix panel (red frame). Check recipe, volume, warehouse. With a selected task, fields fill in.',
    ],
    ['Провести замес', 'Post the mix'],
    [
      'Когда состав готов, нажмите кнопку проведения замеса в красной рамке. После этого задание закроется, можно печатать этикетку куба.',
      'When ready, tap Post mix in the red frame. The task closes; you can print the cube label.',
    ],
    ['Категории журнала', 'Journal categories'],
    [
      'Нажмите плитки категорий в красной рамке (склад, кадры, финансы…). Так отсекаете лишние события. Можно включить несколько категорий.',
      'Tap category tiles (red frame): warehouse, HR, finance… Filter noise. Several categories can be on.',
    ],
    ['Фильтры журнала', 'Journal filters'],
    [
      'Ниже — фильтры в красной рамке: поиск, автор, статус, период. Журнал показывает «кто что менял» для разбора спорных случаев.',
      'Below — filters (red frame): search, author, status, period. The journal shows who changed what.',
    ],
    ['Вкладка «Заказчики»', 'Customers tab'],
    [
      'Нажмите вкладку заказчиков/контрагентов в красной рамке. Здесь заводят клиентов и поставщиков, которых потом выбирают в заказах.',
      'Tap Customers/counterparties (red frame). Clients and suppliers used later in orders.',
    ],
    ['Список для текущего раздела. Следующий шаг — только после клика по красной рамке.',
      'Guides for the current section. Next step only after you click the red frame.'],
    ['В этом разделе пока нет готовых инструкций.', 'No guides in this section yet.'],
    ['Начать', 'Start'],
    ['шаг.', 'steps'],
    ['Шаг {n} из {total}', 'Step {n} of {total}'],
    ['Стоп', 'Stop'],
    [
      'Нажмите на элемент в красной рамке — только тогда перейдём дальше',
      'Click the element in the red frame — only then we continue',
    ],
    [
      'Нужная кнопка сейчас не на экране. Откройте вкладку или меню и нажмите «Искать снова».',
      'The button is not on screen. Open the tab or menu, then tap Retry.',
    ],
    ['Искать снова', 'Retry'],
    ['Готово — вы прошли инструкцию', 'Done — you completed the guide'],
    ['Функции', 'Functions'],
    ['Спросить', 'Ask'],
    ['Найти функцию…', 'Find a function…'],
    ['Начисления зарплаты', 'Payroll accruals'],
    [
      'Коэффициенты ночных, простоя, сверхурочных и фикс за ночь на линии',
      'Night, idle, overtime rates and a fixed night-line bonus',
    ],
    ['Вкладка «Начисления»', 'Accruals tab'],
    ['Фикс за ночь на линии', 'Night-line fixed bonus'],
    [
      'В таблице начислений найдите строку «Ночь на линии» в красной рамке. Это фиксированные 20 ₾ за каждую ночную смену на пропитке — поверх +25% за часы. Можно изменить сумму и сохранить.',
      'In the accruals table find Night on the line (red frame). That is a fixed 20 ₾ for each night shift on impregnation — on top of +25% for hours. You can change the amount and save.',
    ],
  ]
  let out = s
  for (const [a, b] of map) out = out.split(a).join(b)
  return out
}

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function block(chrome, translate) {
  return pairs
    .map(([k, v]) => `  '${k}': '${esc(chrome[k] || translate(v, k))}',`)
    .join('\n')
}

const MARKER_START = '  // --- coach.guide (generated) ---'
const MARKER_END = '  // --- /coach.guide ---'

function inject(path, lines, title, subtitle) {
  let src = fs.readFileSync(path, 'utf8')
  src = src.replace(/'coach\.open': '((?:\\'|[^'])*)'/, `'coach.open': '${esc(title)}'`)
  src = src.replace(/'coach\.title': '((?:\\'|[^'])*)'/, `'coach.title': '${esc(title)}'`)
  src = src.replace(/'coach\.subtitle': '((?:\\'|[^'])*)'/, `'coach.subtitle': '${esc(subtitle)}'`)

  // Drop previous generated / stray coach.guide blocks
  src = src.replace(
    /\n?  \/\/ --- coach\.guide \(generated\) ---[\s\S]*?  \/\/ --- \/coach\.guide ---\n?/,
    '\n',
  )
  src = src.replace(/\n  'coach\.guide\.[^']+': '((?:\\'|[^'])*)',/g, '')

  const chunk = `\n${MARKER_START}\n${lines}\n${MARKER_END}\n`
  if (!src.includes("'coachAnalytics.title'")) {
    console.error('coachAnalytics.title not found in', path)
    process.exit(1)
  }
  src = src.replace(/(\n  'coachAnalytics\.title':)/, `${chunk}$1`)
  fs.writeFileSync(path, src)
  console.log('updated', path, pairs.length)
}

inject(
  'src/i18n/en.ts',
  block(enChrome, (v) => ruToEn(v)),
  'Instructor',
  'Pick a function — I will show where to click',
)
inject(
  'src/i18n/ka.ts',
  block(kaChrome, ruToKa),
  'ინსტრუქტორი',
  'აირჩიეთ ფუნქცია — გიჩვენებთ სად დააჭიროთ',
)
console.log('done', pairs.length)
