/**
 * Встроенный банк уроков (6 тем, испанский, A1–A2) — запасной путь, когда модель недоступна.
 * Структура та же, что у сгенерированного урока (см. types.ts).
 */
import type { Lesson } from "./types.ts";

export type BankLesson = Omit<Lesson, "topicId" | "topic" | "level" | "source">;

export const BANK: Record<string, BankLesson> = {
  greetings: {
    title: "Знакомство: как поздороваться и представиться",
    vocab: [
      { es: "hola", ru: "привет", example: "¡Hola! ¿Qué tal?", exampleRu: "Привет! Как дела?" },
      { es: "buenos días", ru: "доброе утро", example: "Buenos días, señora López.", exampleRu: "Доброе утро, сеньора Лопес." },
      { es: "¿cómo estás?", ru: "как дела?", example: "Hola, Ana, ¿cómo estás?", exampleRu: "Привет, Ана, как дела?" },
      { es: "me llamo", ru: "меня зовут", example: "Me llamo Pablo.", exampleRu: "Меня зовут Пабло." },
      { es: "mucho gusto", ru: "очень приятно", example: "Mucho gusto, Carmen.", exampleRu: "Очень приятно, Кармен." },
      { es: "adiós", ru: "до свидания", example: "Adiós, hasta mañana.", exampleRu: "До свидания, до завтра." },
      { es: "gracias", ru: "спасибо", example: "Muchas gracias por todo.", exampleRu: "Большое спасибо за всё." },
      { es: "por favor", ru: "пожалуйста (просьба)", example: "Un café, por favor.", exampleRu: "Кофе, пожалуйста." },
    ],
    grammar: {
      title: "Глагол ser («быть») в настоящем времени",
      explanation:
        "Ser описывает, кто мы, откуда и какие: имя, национальность, профессия, характер. Местоимения (yo, tú…) часто опускают — форма глагола уже показывает лицо.",
      table: [
        ["yo", "soy"],
        ["tú", "eres"],
        ["él / ella / usted", "es"],
        ["nosotros / nosotras", "somos"],
        ["vosotros / vosotras", "sois"],
        ["ellos / ellas / ustedes", "son"],
      ],
      examples: [
        { es: "Soy de Rusia.", ru: "Я из России." },
        { es: "¿Eres profesor?", ru: "Ты учитель?" },
        { es: "Ella es muy simpática.", ru: "Она очень приятная." },
      ],
    },
    phrases: [
      { es: "¿De dónde eres?", ru: "Откуда ты?" },
      { es: "Soy de Moscú.", ru: "Я из Москвы." },
      { es: "¿Cómo te llamas?", ru: "Как тебя зовут?" },
      { es: "Encantado de conocerte.", ru: "Рад познакомиться." },
      { es: "Hasta luego.", ru: "До скорого." },
      { es: "¿Qué tal?", ru: "Как дела? (неформально)" },
    ],
    listening: [
      { es: "Hola, me llamo Carlos y soy de Barcelona.", ru: "Привет, меня зовут Карлос, я из Барселоны.", question: "Откуда Карлос?", options: ["Из Барселоны", "Из Мадрида", "Из Севильи"], answer: 0 },
      { es: "Buenas tardes. ¿Cómo estás? Yo estoy muy bien, gracias.", ru: "Добрый день. Как дела? У меня всё очень хорошо, спасибо.", question: "Как себя чувствует говорящий?", options: ["Плохо", "Очень хорошо", "Устал"], answer: 1 },
    ],
    exercises: [
      { type: "fill", sentence: "Yo ___ de Rusia.", answer: "soy", hint: "ser, yo", ru: "Я из России." },
      { type: "choose", question: "Как сказать «До скорого»?", options: ["Hasta luego", "Buenos días", "Gracias"], answer: 0 },
      { type: "translate", ru: "Меня зовут Анна.", es: "Me llamo Ana.", accept: ["Yo me llamo Ana", "Me llamo Anna"] },
      { type: "fill", sentence: "¿Cómo ___ llamas?", answer: "te", hint: "возвратное местоимение для tú", ru: "Как тебя зовут?" },
    ],
    quiz: [
      { question: "«Buenas noches» — это…", options: ["Добрый вечер / спокойной ночи", "Доброе утро", "До свидания"], answer: 0 },
      { question: "Tú ___ estudiante.", options: ["eres", "es", "soy"], answer: 0 },
      { question: "«Mucho gusto» значит…", options: ["Очень вкусно", "Очень приятно", "Большое спасибо"], answer: 1 },
      { question: "Как спросить «Как дела?»", options: ["¿Cómo estás?", "¿Cómo te llamas?", "¿De dónde eres?"], answer: 0 },
      { question: "Nosotros ___ de España.", options: ["somos", "sois", "son"], answer: 0 },
    ],
  },
  daily: {
    title: "Мой день: от подъёма до сна",
    vocab: [
      { es: "levantarse", ru: "вставать", example: "Me levanto a las siete.", exampleRu: "Я встаю в семь." },
      { es: "desayunar", ru: "завтракать", example: "Desayuno café con leche.", exampleRu: "Я завтракаю кофе с молоком." },
      { es: "trabajar", ru: "работать", example: "Trabajo en una oficina.", exampleRu: "Я работаю в офисе." },
      { es: "comer", ru: "есть; обедать", example: "Comemos a las dos.", exampleRu: "Мы обедаем в два." },
      { es: "volver a casa", ru: "возвращаться домой", example: "Vuelvo a casa a las seis.", exampleRu: "Я возвращаюсь домой в шесть." },
      { es: "cenar", ru: "ужинать", example: "Ceno con mi familia.", exampleRu: "Я ужинаю с семьёй." },
      { es: "acostarse", ru: "ложиться спать", example: "Me acuesto a las once.", exampleRu: "Я ложусь в одиннадцать." },
      { es: "la mañana", ru: "утро", example: "Por la mañana estudio.", exampleRu: "Утром я учусь." },
    ],
    grammar: {
      title: "Правильные глаголы на -ar в настоящем времени",
      explanation:
        "У глаголов на -ar (trabajar, desayunar, cenar) отбрасываем -ar и добавляем окончания: -o, -as, -a, -amos, -áis, -an. Возвратные глаголы (levantarse, acostarse) идут с me, te, se, nos, os, se перед глаголом.",
      table: [
        ["yo", "trabajo"],
        ["tú", "trabajas"],
        ["él / ella / usted", "trabaja"],
        ["nosotros", "trabajamos"],
        ["vosotros", "trabajáis"],
        ["ellos / ustedes", "trabajan"],
      ],
      examples: [
        { es: "Trabajo en una oficina.", ru: "Я работаю в офисе." },
        { es: "Desayunamos a las ocho.", ru: "Мы завтракаем в восемь." },
        { es: "¿A qué hora cenas?", ru: "Во сколько ты ужинаешь?" },
      ],
    },
    phrases: [
      { es: "Me levanto a las siete.", ru: "Я встаю в семь." },
      { es: "¿A qué hora te levantas?", ru: "Во сколько ты встаёшь?" },
      { es: "Por la mañana trabajo.", ru: "Утром я работаю." },
      { es: "Por la tarde estudio español.", ru: "Днём я учу испанский." },
      { es: "Por la noche veo la tele.", ru: "Вечером я смотрю телевизор." },
      { es: "Me acuesto tarde.", ru: "Я ложусь поздно." },
    ],
    listening: [
      { es: "Me levanto a las siete y desayuno café con tostadas.", ru: "Я встаю в семь и завтракаю кофе с тостами.", question: "Что говорящий ест на завтрак?", options: ["Кофе с тостами", "Яичницу", "Кашу"], answer: 0 },
      { es: "Por la tarde trabajo en casa y por la noche ceno con mi familia.", ru: "Днём я работаю дома, а вечером ужинаю с семьёй.", question: "Где говорящий работает днём?", options: ["В офисе", "Дома", "В кафе"], answer: 1 },
    ],
    exercises: [
      { type: "fill", sentence: "Nosotros ___ a las dos.", answer: "comemos", hint: "comer, nosotros", ru: "Мы обедаем в два." },
      { type: "choose", question: "«Acostarse» — это…", options: ["Ложиться спать", "Вставать", "Ужинать"], answer: 0 },
      { type: "translate", ru: "Я работаю утром.", es: "Trabajo por la mañana.", accept: ["Yo trabajo por la mañana", "Por la mañana trabajo"] },
      { type: "fill", sentence: "¿A qué hora te ___?", answer: "levantas", hint: "levantarse, tú", ru: "Во сколько ты встаёшь?" },
    ],
    quiz: [
      { question: "Ellos ___ en un banco.", options: ["trabajan", "trabaja", "trabajamos"], answer: 0 },
      { question: "«Cenar» значит…", options: ["Завтракать", "Обедать", "Ужинать"], answer: 2 },
      { question: "Yo ___ a las once.", options: ["me acuesto", "me acuestas", "acuesto"], answer: 0 },
      { question: "«Por la noche» — это…", options: ["Утром", "Днём", "Вечером / ночью"], answer: 2 },
      { question: "Tú ___ café.", options: ["desayunas", "desayuno", "desayunan"], answer: 0 },
    ],
  },
  food: {
    title: "В ресторане: заказать и расплатиться",
    vocab: [
      { es: "la carta", ru: "меню", example: "¿Me trae la carta, por favor?", exampleRu: "Принесите меню, пожалуйста." },
      { es: "el camarero", ru: "официант", example: "El camarero es muy amable.", exampleRu: "Официант очень любезный." },
      { es: "la cuenta", ru: "счёт", example: "La cuenta, por favor.", exampleRu: "Счёт, пожалуйста." },
      { es: "el agua", ru: "вода", example: "Un vaso de agua, por favor.", exampleRu: "Стакан воды, пожалуйста." },
      { es: "el pan", ru: "хлеб", example: "El pan está caliente.", exampleRu: "Хлеб тёплый." },
      { es: "la carne", ru: "мясо", example: "No como carne.", exampleRu: "Я не ем мясо." },
      { es: "el pescado", ru: "рыба", example: "El pescado está muy rico.", exampleRu: "Рыба очень вкусная." },
      { es: "el postre", ru: "десерт", example: "¿Qué hay de postre?", exampleRu: "Что есть на десерт?" },
    ],
    grammar: {
      title: "Querer («хотеть») и gustar («нравиться»)",
      explanation:
        "Заказываем через quiero + блюдо. Gustar устроен иначе: «мне нравится» = me gusta + ед. число, me gustan + мн. число; меняется не глагол по лицам, а местоимение (me, te, le, nos, os, les).",
      table: [
        ["yo", "quiero"],
        ["tú", "quieres"],
        ["él / ella / usted", "quiere"],
        ["nosotros", "queremos"],
        ["vosotros", "queréis"],
        ["ellos / ustedes", "quieren"],
      ],
      examples: [
        { es: "Quiero una ensalada.", ru: "Я хочу салат." },
        { es: "Me gusta el pescado.", ru: "Мне нравится рыба." },
        { es: "¿Qué quieres beber?", ru: "Что ты хочешь пить?" },
      ],
    },
    phrases: [
      { es: "Una mesa para dos, por favor.", ru: "Столик на двоих, пожалуйста." },
      { es: "¿Qué me recomienda?", ru: "Что вы посоветуете?" },
      { es: "Para mí, la paella.", ru: "Мне — паэлью." },
      { es: "La cuenta, por favor.", ru: "Счёт, пожалуйста." },
      { es: "¿Tienen menú del día?", ru: "У вас есть комплексный обед?" },
      { es: "Está muy rico.", ru: "Очень вкусно." },
    ],
    listening: [
      { es: "Para mí una sopa y después pescado con patatas, por favor.", ru: "Мне суп, а потом рыбу с картошкой, пожалуйста.", question: "Что заказал говорящий?", options: ["Суп и рыбу с картошкой", "Салат и мясо", "Паэлью и десерт"], answer: 0 },
      { es: "La cuenta, por favor. ¿Puedo pagar con tarjeta?", ru: "Счёт, пожалуйста. Можно заплатить картой?", question: "Как говорящий хочет заплатить?", options: ["Наличными", "Картой", "Он не хочет платить"], answer: 1 },
    ],
    exercises: [
      { type: "fill", sentence: "___ una botella de agua, por favor.", answer: "Quiero", hint: "querer, yo", ru: "Хочу бутылку воды, пожалуйста." },
      { type: "choose", question: "«La cuenta» — это…", options: ["Счёт", "Меню", "Стол"], answer: 0 },
      { type: "translate", ru: "Мне нравится хлеб.", es: "Me gusta el pan.", accept: ["A mí me gusta el pan"] },
      { type: "fill", sentence: "Me ___ las patatas.", answer: "gustan", hint: "gustar, мн. число", ru: "Мне нравится картошка." },
    ],
    quiz: [
      { question: "«El postre» — это…", options: ["Десерт", "Суп", "Напиток"], answer: 0 },
      { question: "¿Qué ___ tú?", options: ["quieres", "quiero", "quiere"], answer: 0 },
      { question: "Как попросить счёт?", options: ["La cuenta, por favor.", "La carta, por favor.", "Una mesa, por favor."], answer: 0 },
      { question: "Me ___ el café.", options: ["gusta", "gustan", "gusto"], answer: 0 },
      { question: "«Está muy rico» значит…", options: ["Очень дорого", "Очень вкусно", "Очень холодно"], answer: 1 },
    ],
  },
  family: {
    title: "Семья: кто есть кто",
    vocab: [
      { es: "la madre", ru: "мать", example: "Mi madre es profesora.", exampleRu: "Моя мама — учительница." },
      { es: "el padre", ru: "отец", example: "Mi padre trabaja mucho.", exampleRu: "Мой папа много работает." },
      { es: "el hermano", ru: "брат", example: "Tengo un hermano mayor.", exampleRu: "У меня есть старший брат." },
      { es: "la hermana", ru: "сестра", example: "Mi hermana vive en Madrid.", exampleRu: "Моя сестра живёт в Мадриде." },
      { es: "los abuelos", ru: "бабушка и дедушка", example: "Mis abuelos viven en el pueblo.", exampleRu: "Мои бабушка и дедушка живут в деревне." },
      { es: "el hijo", ru: "сын", example: "Su hijo tiene cinco años.", exampleRu: "Его сыну пять лет." },
      { es: "la hija", ru: "дочь", example: "Nuestra hija estudia medicina.", exampleRu: "Наша дочь учится на врача." },
      { es: "el marido / la mujer", ru: "муж / жена", example: "Mi mujer se llama Laura.", exampleRu: "Мою жену зовут Лаура." },
    ],
    grammar: {
      title: "Притяжательные местоимения: mi, tu, su, nuestro",
      explanation:
        "Притяжательные стоят перед существительным и согласуются с ним в числе: mi hermano — mis hermanos. Nuestro ещё и по роду: nuestra casa, nuestros padres. Su — универсальное «его, её, их, Ваш».",
      table: [
        ["mi / mis", "мой, моя / мои"],
        ["tu / tus", "твой, твоя / твои"],
        ["su / sus", "его, её, их, Ваш / Ваши"],
        ["nuestro, nuestra / nuestros, nuestras", "наш, наша / наши"],
      ],
      examples: [
        { es: "Mi hermana vive en Madrid.", ru: "Моя сестра живёт в Мадриде." },
        { es: "Sus padres son médicos.", ru: "Его родители — врачи." },
        { es: "Nuestra casa es grande.", ru: "Наш дом большой." },
      ],
    },
    phrases: [
      { es: "¿Tienes hermanos?", ru: "У тебя есть братья или сёстры?" },
      { es: "Tengo dos hermanos.", ru: "У меня два брата." },
      { es: "Mi madre se llama Elena.", ru: "Мою маму зовут Елена." },
      { es: "Vivo con mi familia.", ru: "Я живу с семьёй." },
      { es: "Mis abuelos viven en el pueblo.", ru: "Мои бабушка и дедушка живут в деревне." },
      { es: "Somos cuatro en casa.", ru: "Нас дома четверо." },
    ],
    listening: [
      { es: "Tengo una hermana mayor y un hermano pequeño.", ru: "У меня есть старшая сестра и младший брат.", question: "Кто есть у говорящего?", options: ["Сестра и брат", "Два брата", "Две сестры"], answer: 0 },
      { es: "Mi padre es médico y mi madre es profesora.", ru: "Мой папа врач, а мама учительница.", question: "Кем работает мама?", options: ["Врач", "Учительница", "Инженер"], answer: 1 },
    ],
    exercises: [
      { type: "fill", sentence: "___ hermanos viven en Barcelona.", answer: "Mis", hint: "«мои», мн. число", ru: "Мои братья живут в Барселоне." },
      { type: "choose", question: "«Los abuelos» — это…", options: ["Родители", "Бабушка и дедушка", "Дети"], answer: 1 },
      { type: "translate", ru: "Моя сестра — студентка.", es: "Mi hermana es estudiante.", accept: ["Mi hermana es una estudiante"] },
      { type: "fill", sentence: "¿Cómo se llama ___ madre?", answer: "tu", hint: "«твоя»", ru: "Как зовут твою маму?" },
    ],
    quiz: [
      { question: "«La hija» — это…", options: ["Дочь", "Сын", "Сестра"], answer: 0 },
      { question: "___ casa es pequeña. (наша)", options: ["Nuestra", "Nuestro", "Nuestras"], answer: 0 },
      { question: "Tengo ___ hermanos.", options: ["dos", "una", "el"], answer: 0 },
      { question: "«Su» может значить…", options: ["Только «его»", "Его, её, их, Ваш", "Только «их»"], answer: 1 },
      { question: "El padre de mi padre es mi ___.", options: ["abuelo", "hijo", "hermano"], answer: 0 },
    ],
  },
  travel: {
    title: "В дороге: билеты, вокзал, отель",
    vocab: [
      { es: "el billete", ru: "билет", example: "Un billete a Sevilla, por favor.", exampleRu: "Один билет до Севильи, пожалуйста." },
      { es: "el aeropuerto", ru: "аэропорт", example: "El aeropuerto está lejos.", exampleRu: "Аэропорт далеко." },
      { es: "la estación", ru: "вокзал, станция", example: "¿Dónde está la estación?", exampleRu: "Где вокзал?" },
      { es: "el tren", ru: "поезд", example: "El tren sale a las nueve.", exampleRu: "Поезд отправляется в девять." },
      { es: "la maleta", ru: "чемодан", example: "Mi maleta es azul.", exampleRu: "Мой чемодан синий." },
      { es: "el hotel", ru: "отель", example: "El hotel está en el centro.", exampleRu: "Отель в центре." },
      { es: "la reserva", ru: "бронь", example: "Tengo una reserva.", exampleRu: "У меня бронь." },
      { es: "el pasaporte", ru: "паспорт", example: "Su pasaporte, por favor.", exampleRu: "Ваш паспорт, пожалуйста." },
    ],
    grammar: {
      title: "Глагол ir («идти, ехать») и конструкция ir a + инфинитив",
      explanation:
        "Ir неправильный, его формы нужно запомнить. Направление — через a: voy a Madrid. А «ir a + инфинитив» значит «собираться что-то сделать»: voy a reservar — я собираюсь забронировать. a + el сливается в al.",
      table: [
        ["yo", "voy"],
        ["tú", "vas"],
        ["él / ella / usted", "va"],
        ["nosotros", "vamos"],
        ["vosotros", "vais"],
        ["ellos / ustedes", "van"],
      ],
      examples: [
        { es: "Voy a Barcelona en tren.", ru: "Я еду в Барселону на поезде." },
        { es: "Vamos a reservar un hotel.", ru: "Мы собираемся забронировать отель." },
        { es: "¿Vas al aeropuerto?", ru: "Ты едешь в аэропорт?" },
      ],
    },
    phrases: [
      { es: "¿Dónde está la estación?", ru: "Где вокзал?" },
      { es: "Un billete a Sevilla, por favor.", ru: "Один билет до Севильи, пожалуйста." },
      { es: "Tengo una reserva a nombre de García.", ru: "У меня бронь на имя Гарсия." },
      { es: "¿A qué hora sale el tren?", ru: "Во сколько отправляется поезд?" },
      { es: "He perdido mi maleta.", ru: "Я потерял чемодан." },
      { es: "¿Cuánto cuesta?", ru: "Сколько стоит?" },
    ],
    listening: [
      { es: "El tren a Valencia sale a las nueve y media del andén cuatro.", ru: "Поезд в Валенсию отправляется в половине десятого с четвёртой платформы.", question: "С какой платформы поезд?", options: ["Со второй", "С четвёртой", "С девятой"], answer: 1 },
      { es: "Tengo una reserva para dos noches, habitación doble.", ru: "У меня бронь на две ночи, двухместный номер.", question: "На сколько ночей бронь?", options: ["На одну", "На две", "На три"], answer: 1 },
    ],
    exercises: [
      { type: "fill", sentence: "Nosotros ___ a Madrid mañana.", answer: "vamos", hint: "ir, nosotros", ru: "Мы едем в Мадрид завтра." },
      { type: "choose", question: "«La maleta» — это…", options: ["Чемодан", "Билет", "Паспорт"], answer: 0 },
      { type: "translate", ru: "Где отель?", es: "¿Dónde está el hotel?", accept: ["Dónde está el hotel"] },
      { type: "fill", sentence: "¿A qué hora ___ el tren?", answer: "sale", hint: "salir, él", ru: "Во сколько отправляется поезд?" },
    ],
    quiz: [
      { question: "Yo ___ al aeropuerto en taxi.", options: ["voy", "vas", "va"], answer: 0 },
      { question: "«El billete» — это…", options: ["Билет", "Поезд", "Вокзал"], answer: 0 },
      { question: "Ellos ___ a viajar en verano.", options: ["van", "vamos", "vais"], answer: 0 },
      { question: "«¿Cuánto cuesta?» значит…", options: ["Сколько времени?", "Сколько стоит?", "Куда ехать?"], answer: 1 },
      { question: "Как сказать «бронь»?", options: ["la reserva", "la estación", "la maleta"], answer: 0 },
    ],
  },
  weather: {
    title: "Погода и выходные",
    vocab: [
      { es: "hace calor", ru: "жарко", example: "Hoy hace mucho calor.", exampleRu: "Сегодня очень жарко." },
      { es: "hace frío", ru: "холодно", example: "En enero hace frío.", exampleRu: "В январе холодно." },
      { es: "llueve", ru: "идёт дождь", example: "Llueve todo el día.", exampleRu: "Дождь идёт весь день." },
      { es: "el sol", ru: "солнце", example: "Hace sol en la playa.", exampleRu: "На пляже солнечно." },
      { es: "la playa", ru: "пляж", example: "Vamos a la playa.", exampleRu: "Идём на пляж." },
      { es: "nadar", ru: "плавать", example: "Me gusta nadar en el mar.", exampleRu: "Мне нравится плавать в море." },
      { es: "el cine", ru: "кино", example: "¿Vamos al cine?", exampleRu: "Пойдём в кино?" },
      { es: "pasear", ru: "гулять", example: "Paseo por el parque.", exampleRu: "Я гуляю по парку." },
    ],
    grammar: {
      title: "Безличные выражения о погоде",
      explanation:
        "О погоде говорят без подлежащего: hace + существительное (hace sol, hace calor, hace frío, hace viento), está + прилагательное (está nublado), глаголы llueve и nieva. Вопрос: ¿Qué tiempo hace?",
      table: [
        ["Hace sol", "Солнечно"],
        ["Hace calor / frío", "Жарко / холодно"],
        ["Hace viento", "Ветрено"],
        ["Está nublado", "Пасмурно"],
        ["Llueve / Nieva", "Идёт дождь / снег"],
      ],
      examples: [
        { es: "Hoy hace mucho calor.", ru: "Сегодня очень жарко." },
        { es: "En invierno nieva en Moscú.", ru: "Зимой в Москве идёт снег." },
        { es: "¿Qué tiempo hace en Madrid?", ru: "Какая погода в Мадриде?" },
      ],
    },
    phrases: [
      { es: "¿Qué haces los fines de semana?", ru: "Что ты делаешь по выходным?" },
      { es: "Me gusta pasear por el parque.", ru: "Мне нравится гулять по парку." },
      { es: "Vamos a la playa.", ru: "Пойдём на пляж." },
      { es: "Cuando llueve, veo películas.", ru: "Когда идёт дождь, я смотрю фильмы." },
      { es: "¿Quieres ir al cine?", ru: "Хочешь пойти в кино?" },
      { es: "Hace buen tiempo.", ru: "Хорошая погода." },
    ],
    listening: [
      { es: "Hoy hace sol y calor, así que vamos a la playa a nadar.", ru: "Сегодня солнечно и жарко, так что идём на пляж плавать.", question: "Куда идут говорящие?", options: ["В кино", "На пляж", "В парк"], answer: 1 },
      { es: "Está nublado y llueve, mejor nos quedamos en casa.", ru: "Пасмурно и идёт дождь, лучше останемся дома.", question: "Какая погода?", options: ["Солнечно", "Пасмурно и дождь", "Снег"], answer: 1 },
    ],
    exercises: [
      { type: "fill", sentence: "En verano ___ mucho calor.", answer: "hace", hint: "hacer, безличная форма", ru: "Летом очень жарко." },
      { type: "choose", question: "«Llueve» значит…", options: ["Идёт снег", "Идёт дождь", "Ветрено"], answer: 1 },
      { type: "translate", ru: "Мне нравится плавать.", es: "Me gusta nadar.", accept: ["A mí me gusta nadar"] },
      { type: "fill", sentence: "¿Quieres ir ___ cine?", answer: "al", hint: "a + el", ru: "Хочешь пойти в кино?" },
    ],
    quiz: [
      { question: "«Hace frío» — это…", options: ["Жарко", "Холодно", "Ветрено"], answer: 1 },
      { question: "«La playa» — это…", options: ["Пляж", "Парк", "Кино"], answer: 0 },
      { question: "Está ___. (пасмурно)", options: ["nublado", "sol", "calor"], answer: 0 },
      { question: "«Pasear» значит…", options: ["Плавать", "Гулять", "Спать"], answer: 1 },
      { question: "¿Qué ___ hace hoy?", options: ["tiempo", "hora", "día"], answer: 0 },
    ],
  },
};
