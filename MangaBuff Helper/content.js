// Content Script - Работает на страницах mangabuff.ru

// Проверка что скрипт не загружен дважды
if (window.mangabuffHelperLoaded) {
    console.log('⚠️ MangaBuff Helper уже загружен, пропускаем');
} else {
    window.mangabuffHelperLoaded = true;
    console.log('🚀 MangaBuff Helper загружен!');
}

// Глобальные переменные
let mineInterval = null;
let commentInterval = null;
let readerInterval = null;
let isRunning = {
    mine: false,
    comments: false,
    reader: false,
    quiz: false
};

// Статистика
let stats = {
    mineClicks: 0,
    commentsSent: 0,
    pumpkinsFound: 0,
    pumpkinsToday: 0,
    lastResetDate: null,
    quizCompleted: 0
};

// Константы
const DAILY_PUMPKIN_LIMIT = 35;
const PUMPKIN_WAIT_TIME = 3 * 60 * 1000; // 3 минуты в миллисекундах
const SMALL_EVENT_SELECTORS = [
    '.event-gift-ball-4',
    '.event-gift-ball',
    '.event-gift-ball-2',
    '[class*="event-gift"]',
    '[class*="event-flower"]',
    '[class*="flower"]'
];
const BIG_EVENT_SELECTORS = [
    '.event-bag-4',
    '.event-gift-bag-4',
    '.event-gift-box-4',
    '.event-bag',
    '[class*="event-bag"]',
    '[class*="event-gift-big"]',
    '[class*="flower-bag"]',
    '[class*="flower-box"]',
    '[class*="event-flower-big"]'
];

// Флаг ожидания после тыквы
let waitingAfterPumpkin = false;

function isCollectedEventElement(el) {
    if (!el) return true;
    const className = (el.className || '').toString().toLowerCase();
    return className.includes('collected') ||
        className.includes('opened') ||
        className.includes('done') ||
        el.getAttribute('data-mangabuff-clicked') === 'true';
}

// Загрузка статистики
async function loadStats() {
    const stored = await chrome.storage.local.get([
        'mineClicks', 'commentsSent', 'pumpkinsFound',
        'pumpkinsToday', 'quizCompleted'
    ]);

    // Просто загружаем статистику без автоматического сброса
    stats = {
        mineClicks: stored.mineClicks || 0,
        commentsSent: stored.commentsSent || 0,
        pumpkinsFound: stored.pumpkinsFound || 0,
        pumpkinsToday: stored.pumpkinsToday || 0,
        lastResetDate: null,
        quizCompleted: stored.quizCompleted || 0
    };

    console.log(`📊 Статистика загружена. Игрушек сегодня: ${stats.pumpkinsToday}/35`);
}

// Сохранение статистики
async function saveStats() {
    await chrome.storage.local.set(stats);
    chrome.runtime.sendMessage({ action: 'updateStats' });
}

// Слушаем изменения в storage (для синхронизации счетчиков)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        // Обновляем локальный stats если изменились счетчики
        if (changes.mineClicks) stats.mineClicks = changes.mineClicks.newValue || 0;
        if (changes.commentsSent) stats.commentsSent = changes.commentsSent.newValue || 0;
        if (changes.pumpkinsFound) stats.pumpkinsFound = changes.pumpkinsFound.newValue || 0;
        if (changes.pumpkinsToday) stats.pumpkinsToday = changes.pumpkinsToday.newValue || 0;
        if (changes.quizCompleted) stats.quizCompleted = changes.quizCompleted.newValue || 0;

        console.log('📊 Счетчики обновлены из storage:', stats);
    }
});

// Утилита: случайное число
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Утилита: задержка
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// ШАХТА
// ============================================

function findMineButton() {
    // Пробуем разные селекторы
    const selectors = [
        'button[class*="mine"]',
        'button[class*="dig"]',
        'button[class*="click"]',
        '.mine-button',
        '#mine-button',
        'button[onclick*="mine"]',
    ];

    for (let selector of selectors) {
        try {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) {
                return btn;
            }
        } catch (e) { }
    }

    // Поиск по тексту
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('копать') || text.includes('рыть') ||
            text.includes('mine') || text.includes('dig') || text.includes('добыть')) {
            return btn;
        }
    }

    return null;
}

async function clickMine(settings) {
    const button = findMineButton();

    if (!button) {
        console.error('Кнопка шахты не найдена');
        return false;
    }

    if (button.disabled) {
        console.log('Кнопка заблокирована');
        return false;
    }

    button.click();
    stats.mineClicks++;
    await saveStats();

    console.log(`⛏️ Клик в шахте #${stats.mineClicks}`);

    // Проверка лимита
    if (settings.mineMaxClicks > 0 && stats.mineClicks >= settings.mineMaxClicks) {
        await stopMine();
        console.log('Достигнут лимит кликов');
        return false;
    }

    return true;
}

async function startMine(settings) {
    if (isRunning.mine) {
        console.log('Шахта уже работает');
        return;
    }

    isRunning.mine = true;

    // Сохраняем состояние для продолжения после перезагрузки страницы
    await chrome.storage.local.set({
        mineActive: true,
        mineSettings: settings
    });

    console.log('▶ Запуск шахты...');

    async function loop() {
        if (!isRunning.mine) return;

        await clickMine(settings);

        const delay = randomInt(settings.mineDelayMin, settings.mineDelayMax);
        setTimeout(loop, delay);
    }

    loop();
}

async function stopMine() {
    isRunning.mine = false;

    // Сохраняем что шахта остановлена
    await chrome.storage.local.set({ mineActive: false });

    console.log('⏸ Остановка шахты');
}

// ============================================
// КОММЕНТАРИИ
// ============================================

function findCommentInput() {
    const selectors = [
        'textarea[placeholder*="коммент"]',
        'textarea[placeholder*="comment"]',
        'input[placeholder*="коммент"]',
        'textarea[class*="comment"]',
        '.comment-input',
        '#comment-input',
        'textarea',
        'input[type="text"]'
    ];

    for (let selector of selectors) {
        const input = document.querySelector(selector);
        if (input && input.offsetParent !== null) {
            return input;
        }
    }

    return null;
}

function findCommentButton() {
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('отправить') || text.includes('send') ||
            text.includes('коммент') || text.includes('добавить')) {
            return btn;
        }
    }
    return null;
}

// Генератор случайных комментариев - Новогодний снегопад ❄️
const commentTemplates = [
    `　❄⠀　 　　,　　　❅　　⠀　　⠀　,⠀⠀⠀.　　　 　⠀　⠀.　˚　⠀　 　,　　.　　　　.　　❆⠀　⠀ 　⠀❄⠀　❅　⠀⠀.　　⠀⠀❄ ⠀ ⠀　　　ﾟ　　.　.⠀　⠀‍⠀,　❅　⠀.　　.　　　
　⠀❄　˚　　　　.⠀ 　　　.　　.　　❄⠀　 　,　 　.⠀⠀.　　　⠀⠀❆ ⠀ ⠀　　　　⠀⠀ ⠀⠀.　　　. ⠀⠀⠀⠀⠀❄⠀ ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀　❆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀　❅　⠀.
⠀⠀⠀⠀⠀⠀⠀⠀ ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀❄ ⠀ ⠀⠀.　　　　.　ﾟ .　　　. 　　　　❅ 　,　　.⠀⠀⠀⠀⠀⠀⠀⠀⠀　❆　　..　　. 　❄⠀　 　,　❅　⠀　⠀,⠀⠀.　 　⠀.　˚⠀　 　,　.
　.　❆⠀　⠀ ⠀❄⠀❅⠀.　⠀❄ ⠀. 　❄⠀,　❅⠀　⠀,⠀.　 　⠀.˚⠀　　,　.　.　❆⠀　 ⠀❄ ❅⠀.　❄ ⠀ ⠀　ﾟ　.　.⠀‍,　❅.　.　⠀❄˚　.⠀ 　.　.　❄⠀　 　,　 　.⠀.　⠀❆ ⠀ ⠀　
　⠀ ⠀.　. ⠀⠀⠀❄⠀ ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀❆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ⠀⠀⠀⠀❅⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ⠀ ⠀.　　.　ﾟ.　. 　❅ 　,　.⠀⠀⠀⠀⠀　❆　..　. 　❄⠀,　❅　⠀,⠀
.　⠀.　˚⠀　,　.　.　❆⠀　 ⠀❄ ❅.⠀❄ ⠀.　❄⠀　 　　,　　　❅　　⠀　　⠀　,⠀⠀⠀.　　　 　⠀　⠀.　˚　⠀　 　,　　.　　　　.　　❆⠀　⠀ 　⠀❄⠀　❅　⠀⠀.　　⠀⠀❄
⠀ ⠀　　　ﾟ　　.　.⠀　⠀‍⠀,　❅　⠀.　　.　　　　⠀❄　˚　　　　.⠀ 　　　.　　.　　❄⠀　 　,　 　.⠀⠀.　　　⠀⠀❆ ⠀ ⠀　　　　⠀⠀ ⠀⠀.　　　. ⠀⠀⠀⠀⠀❄⠀ ⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀❆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀　❅⠀⠀⠀⠀⠀⠀⠀⠀ ⠀⠀⠀⠀⠀⠀⠀⠀❄⠀⠀⠀⠀⠀⠀ ⠀ ⠀⠀.　　　　.　ﾟ .　　　. 　　　　❅ 　,　　.⠀⠀⠀⠀⠀⠀⠀⠀⠀　❆　　..　　. 　❄⠀　 　,
　❅　⠀　⠀,⠀⠀.　 　⠀.　˚⠀　 　,　.　.　❆⠀　⠀ ⠀❄⠀❅⠀.　⠀❄ ⠀. 　❄⠀,　❅⠀　⠀,⠀.　 　⠀.˚⠀　　,　.　.　❆⠀　 ⠀❄❅⠀.　❄ ⠀ ⠀　ﾟ　.　.⠀‍,　❅.　.　⠀❄˚　.
⠀ 　.　.　❄⠀　 　,　 　.⠀.　⠀❆ ⠀ ⠀　　⠀ ⠀.　. ⠀⠀⠀❄⠀ ⠀⠀⠀⠀⠀⠀⠀⠀❅⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀❆⠀⠀⠀⠀⠀⠀⠀ ⠀⠀⠀⠀⠀⠀⠀⠀⠀❄⠀⠀⠀⠀⠀ ⠀ ⠀.　　.　ﾟ.　. 　❅
　,　.⠀⠀⠀⠀⠀　❆　..　. 　❄⠀,　❅　⠀,⠀.　⠀.　˚⠀　,　.　.　❆⠀　 ⠀❄ ❅.⠀ ❄ ⠀.　❄⠀　 　　,　　　❅　　⠀　　⠀　,⠀⠀⠀.　　　 　⠀　⠀.　˚　⠀　 　,　　.　　
　　.　　❆⠀　⠀ 　⠀❄⠀　❅　⠀⠀.　　⠀⠀❄ ⠀ ⠀　　　ﾟ　　.　.⠀　⠀‍⠀,　❅　⠀.　　.　　　　⠀❄　˚　　　　.⠀ 　　　.　　.　　❄⠀　 　,　 　.⠀⠀.　　　⠀⠀❆ ⠀ ⠀
　　　　⠀⠀ ⠀⠀.　　　. ⠀⠀⠀⠀⠀❄⠀ ⠀⠀⠀⠀⠀⠀⠀⠀⠀❆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀❅⠀⠀⠀⠀⠀⠀ ⠀⠀⠀⠀⠀⠀❄⠀⠀⠀⠀⠀⠀⠀⠀ ⠀ ⠀⠀.　　　　.　ﾟ .　　　. 　　　　❅ 　,　　.⠀⠀⠀⠀⠀⠀⠀
⠀⠀　❆　　..　　. 　❄⠀　 　,　❅　⠀　⠀,⠀⠀.　 　⠀.　˚⠀　 　,　.　.　❆⠀　⠀ ⠀❄⠀❅⠀.　⠀❄ ⠀. 　❄⠀,　❅⠀　⠀,⠀.　 　⠀.˚⠀　　,　.　.　❆⠀　 ⠀❄❅⠀.　❄ ⠀ ⠀　ﾟ
　.　.⠀‍,　❅.　.　⠀❄˚　.⠀ 　.　.　❄⠀　 　,　 　.⠀.　⠀❆ ⠀ ⠀　　⠀ ⠀.　. ⠀⠀⠀❄⠀ ⠀⠀⠀⠀⠀⠀❅⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀❆⠀⠀⠀⠀⠀⠀ ⠀⠀⠀❄⠀⠀⠀⠀⠀⠀⠀⠀ ⠀ ⠀.　　.
　ﾟ.　. 　❅ 　,　.⠀⠀⠀⠀⠀　❆　..　. 　❄⠀,　❅　⠀,⠀.　⠀.　˚⠀　,　.　.　❆⠀　 ⠀❄❅.⠀❄ ⠀.　❄⠀　 　,　❅　⠀⠀,⠀.　⠀.˚⠀　,　.　.　❆⠀ ⠀❄❅.　❄ ⠀ ⠀ﾟ　.　.
⠀,　❅.　.⠀❄˚　.⠀ 　.　.　❄⠀　　,　 　.⠀.　❆ ⠀ ⠀　⠀ ⠀.　. ⠀⠀❄⠀ ⠀⠀⠀⠀⠀❅⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀❆⠀⠀⠀⠀⠀⠀⠀ ⠀⠀❄⠀⠀⠀⠀⠀⠀⠀ ⠀ ⠀.　.　ﾟ.　. 　❅　,　.⠀⠀
⠀⠀　❆　..　. 　❄⠀,　❅　⠀,⠀⠀.　⠀.　˚⠀　,　.　.　❆⠀　 ⠀ ❄ ❅.⠀❄ ⠀. 　❄⠀　 　,　　❅　　⠀　⠀　,⠀⠀.　　　 　⠀　⠀.　˚　⠀　 　,　.　　　.　　❆⠀　⠀ 　⠀❄⠀
　❅　⠀⠀.　　⠀⠀❄ ⠀ ⠀　　ﾟ　　.　.⠀　⠀‍⠀,　❅　⠀.　.　　　　⠀❄　˚　　　.⠀ 　　　.　.　　❄⠀　 　,　 　.⠀⠀.　　⠀⠀❆ ⠀ ⠀　　　⠀⠀ ⠀⠀.　　. ⠀⠀⠀⠀❄⠀ ⠀⠀
⠀⠀⠀⠀⠀⠀❆⠀⠀⠀⠀⠀⠀⠀⠀❅⠀⠀⠀⠀⠀⠀ ⠀⠀⠀❄⠀⠀⠀⠀⠀⠀ ⠀ ⠀.　　　.　ﾟ .　　. 　　　❅ 　,　.⠀⠀⠀⠀⠀⠀　❆　..　. 　❄⠀　,　❅　⠀⠀,⠀.　 　⠀.　˚⠀　,　.　.　❆⠀　 ⠀❄`
];

function getRandomComment() {
    return commentTemplates[randomInt(0, commentTemplates.length - 1)];
}

async function sendComment() {
    const input = findCommentInput();
    const button = findCommentButton();

    if (!input || !button) {
        console.error('Поле комментария или кнопка не найдены');
        return false;
    }

    const comment = getRandomComment();

    // Устанавливаем значение
    input.value = comment;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Небольшая задержка перед кликом
    await sleep(randomInt(100, 300));

    button.click();
    stats.commentsSent++;
    await saveStats();

    console.log(`💬 Комментарий #${stats.commentsSent}: "${comment}"`);
    return true;
}

async function startComments(settings) {
    if (isRunning.comments) {
        console.log('Комментарии уже работают');
        return;
    }

    isRunning.comments = true;
    console.log(`▶ Запуск комментариев (${settings.commentCount} штук)...`);

    let count = 0;

    async function loop() {
        if (!isRunning.comments || count >= settings.commentCount) {
            stopComments();
            console.log(`✅ Отправлено ${count} комментариев`);
            return;
        }

        const success = await sendComment();
        if (success) count++;

        // Фиксированная задержка 30 секунд (из настроек commentDelayMin)
        setTimeout(loop, settings.commentDelayMin);
    }

    loop();
}

function stopComments() {
    isRunning.comments = false;
    console.log('⏸ Остановка комментариев');
}

// ============================================
// ЧИТАЛКА
// ============================================

function findPumpkinLeft() {
    // Ищем тыкву слева по классу event-gift-ball
    const pumpkins = document.querySelectorAll(SMALL_EVENT_SELECTORS.join(', '));

    for (let el of pumpkins) {
        // Пропускаем уже собранные тыквы
        if (isCollectedEventElement(el) || el.classList.contains('event-gift-ball--collected')) {
            continue;
        }

        const rect = el.getBoundingClientRect();
        // Проверяем что элемент пересекается с экраном и находится слева
        const isVisible = rect.right > 0 && rect.left < window.innerWidth &&
            rect.bottom > 0 && rect.top < window.innerHeight;
        if (rect.left < window.innerWidth * 0.4 && isVisible) {
            return el;
        }
    }

    return null;
}

function findPumpkinBottom() {
    // Ищем тыкву снизу тоже по классу event-gift-ball
    const pumpkins = document.querySelectorAll(SMALL_EVENT_SELECTORS.join(', '));

    for (let el of pumpkins) {
        // Пропускаем уже собранные тыквы
        if (isCollectedEventElement(el) || el.classList.contains('event-gift-ball--collected')) {
            continue;
        }

        const rect = el.getBoundingClientRect();

        // Проверяем: внизу экрана и по центру
        const isBottom = rect.top > window.innerHeight * 0.6;
        const isCenter = rect.left > window.innerWidth * 0.3 &&
            rect.right < window.innerWidth * 0.7;
        const isVisible = rect.right > 0 && rect.left < window.innerWidth &&
            rect.bottom > 0 && rect.top < window.innerHeight;

        if (isBottom && isCenter && isVisible) {
            return el;
        }
    }

    return null;
}

async function clickPumpkinLeft() {
    const pumpkin = findPumpkinLeft();
    if (!pumpkin) return false;

    // Помечаем что уже кликнули
    pumpkin.setAttribute('data-mangabuff-clicked', 'true');

    pumpkin.click();
    stats.pumpkinsFound++;
    stats.pumpkinsToday++;
    await saveStats();

    console.log(`� Игрушка слева найдена и нажата! (Сегодня: ${stats.pumpkinsToday}/35)`);
    return true;
}

async function clickPumpkinBottom() {
    const pumpkin = findPumpkinBottom();
    if (!pumpkin) return false;

    // Помечаем что уже кликнули
    pumpkin.setAttribute('data-mangabuff-clicked', 'true');

    const clicks = randomInt(6, 9);
    console.log(`� Игрушка снизу найдена! Нажимаем ${clicks} раз...`);

    for (let i = 0; i < clicks; i++) {
        pumpkin.click();
        await sleep(randomInt(50, 150));
    }

    stats.pumpkinsFound++;
    stats.pumpkinsToday++;
    await saveStats();

    console.log(`� Игрушка собрана! (Сегодня: ${stats.pumpkinsToday}/35)`);
    return true;
}

function findBigPumpkin() {
    // Ищем большую тыкву с классом event-bag
    const bags = document.querySelectorAll(BIG_EVENT_SELECTORS.join(', '));

    for (let el of bags) {
        if (isCollectedEventElement(el)) {
            continue;
        }

        const rect = el.getBoundingClientRect();
        // Проверяем что элемент хотя бы частично видим на экране
        const isVisible = rect.right > 0 && rect.left < window.innerWidth &&
            rect.bottom > 0 && rect.top < window.innerHeight;
        if (isVisible) {
            return el;
        }
    }

    return null;
}

async function clickBigPumpkin() {
    const bigPumpkin = findBigPumpkin();
    if (!bigPumpkin) return false;

    // Помечаем что уже кликнули
    bigPumpkin.setAttribute('data-mangabuff-clicked', 'true');

    console.log(`💰 БОЛЬШОЙ ПОДАРОК найден! Начинаем кликать...`);

    let clickCount = 0;
    // Кликаем пока элемент не пропадет
    while (
        isRunning.reader &&
        document.body.contains(bigPumpkin) &&
        !isCollectedEventElement(bigPumpkin)
    ) {
        bigPumpkin.click();
        clickCount++;
        console.log(`💰 Клик #${clickCount}...`);
        await sleep(1000); // Задержка 1000мс между кликами

        // Защита от бесконечного цикла (максимум 20 кликов)
        if (clickCount >= 20) {
            console.log('⚠️ Достигнут максимум кликов (20), останавливаем');
            break;
        }
    }

    stats.pumpkinsFound++;
    stats.pumpkinsToday++;
    await saveStats();

    console.log(`💰 Большой подарок собран за ${clickCount} кликов! (Сегодня: ${stats.pumpkinsToday}/35)`);
    return true;
}

function findNextPageButton() {
    // Ищем кнопку "следующая страница" (стрелка вправо сверху)
    const nextButtons = document.querySelectorAll('.icon-new-arrow-next, [class*="arrow-next"]');

    for (let btn of nextButtons) {
        if (btn.offsetParent !== null) { // Проверяем что видима
            return btn.closest('a, button') || btn;
        }
    }

    return null;
}

function findNextChapterButton() {
    // Ищем кнопку "следующая глава" (внизу страницы)
    const buttons = document.querySelectorAll('a, button');

    for (let btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('след') || text.includes('next') ||
            text.includes('следующ') || text.includes('вперед')) {
            return btn;
        }
    }

    return null;
}

function isPageEnd() {
    // Проверяем достигли ли конца страницы
    const scrollTop = window.scrollY || window.pageYOffset;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    // Считаем что конец если осталось меньше 100px
    return (scrollTop + windowHeight) >= (documentHeight - 100);
}

async function scrollDown(speed) {
    // Скорость от 1 до 10, преобразуем в пиксели
    const scrollAmount = speed * 50; // 50-500 пикселей

    window.scrollBy({
        top: scrollAmount,
        behavior: 'smooth'
    });
}

async function startReader(settings) {
    if (isRunning.reader) {
        console.log('Читалка уже работает');
        return;
    }

    // Проверяем дневной лимит
    if (stats.pumpkinsToday >= DAILY_PUMPKIN_LIMIT) {
        console.log(`🛑 Достигнут дневной лимит игрушек (${DAILY_PUMPKIN_LIMIT}/35)! Читалка не запустится.`);
        return;
    }

    isRunning.reader = true;
    waitingAfterPumpkin = false;

    // Сохраняем состояние для продолжения после перезагрузки страницы
    await chrome.storage.local.set({
        readerActive: true,
        readerSettings: settings
    });

    console.log(`▶ Запуск читалки... (Игрушек сегодня: ${stats.pumpkinsToday}/35)`);

    async function loop() {
        if (!isRunning.reader) return;

        // Проверяем что мы на странице чтения манги
        if (!window.location.href.includes('mangabuff.ru/manga/')) {
            console.log('⏸️ Не на странице манги, ожидание...');
            setTimeout(loop, 2000); // Проверяем каждые 2 секунды
            return;
        }

        // Если ждем после тыквы - не делаем ничего
        if (waitingAfterPumpkin) {
            setTimeout(loop, 1000);
            return;
        }

        // Проверяем дневной лимит
        if (stats.pumpkinsToday >= DAILY_PUMPKIN_LIMIT) {
            console.log(`🎉 Достигнут дневной лимит! Собрано ${stats.pumpkinsToday} игрушек сегодня.`);
            console.log('⏹️ Останавливаем читалку до завтра.');
            await stopReader();
            return;
        }

        // Проверяем тыквы
        let foundPumpkin = false;

        // Сначала проверяем большую тыкву (event-bag)
        const foundBigPumpkin = await clickBigPumpkin();
        if (foundBigPumpkin) {
            foundPumpkin = true;
        }

        // Если большую не нашли, проверяем маленькую тыкву слева
        if (!foundPumpkin && settings.pumpkinLeft) {
            const foundLeft = await clickPumpkinLeft();
            if (foundLeft) {
                foundPumpkin = true;
            }
        }

        // Для ивентов, где предметы появляются внизу по центру
        if (!foundPumpkin) {
            const foundBottom = await clickPumpkinBottom();
            if (foundBottom) {
                foundPumpkin = true;
            }
        }

        // Если нашли тыкву - запускаем таймер 3 минуты
        if (foundPumpkin) {
            waitingAfterPumpkin = true;
            console.log('⏱️ Игрушка найдена! Останавливаем прокрутку.');
            console.log(`⏳ Ожидание 3 минут перед переходом на следующую страницу...`);

            // Обратный отсчет
            let remainingSeconds = PUMPKIN_WAIT_TIME / 1000;
            const countdownInterval = setInterval(() => {
                if (!isRunning.reader || !waitingAfterPumpkin) {
                    clearInterval(countdownInterval);
                    return;
                }

                remainingSeconds -= 30;
                if (remainingSeconds > 0 && remainingSeconds % 60 === 0) {
                    console.log(`⏳ Осталось ${remainingSeconds / 60} минут...`);
                }
            }, 30000); // Каждые 30 секунд

            // Ждем 3 минуты
            await sleep(PUMPKIN_WAIT_TIME);
            clearInterval(countdownInterval);

            if (!isRunning.reader) return;

            console.log('⏰ Время вышло! Переход на следующую страницу...');

            // Ищем кнопку следующей страницы (стрелка вправо)
            const nextPageBtn = findNextPageButton();

            if (nextPageBtn) {
                console.log('➡️ Нажимаем кнопку "След. страница"');
                nextPageBtn.click();

                // Ждем загрузки новой страницы (увеличена задержка)
                console.log('⏳ Ожидание загрузки страницы (8 секунд)...');
                await sleep(8000);

                waitingAfterPumpkin = false;
                console.log('✅ Продолжаем поиск тыкв...');
                console.log('📜 Начинаем прокрутку новой страницы');
                console.log('🔍 URL:', window.location.href);

                // Запускаем следующую итерацию
                setTimeout(() => {
                    console.log('🔄 Перезапуск цикла прокрутки...');
                    loop();
                }, settings.scrollDelay);
                return;
            } else {
                console.log('⚠️ Кнопка "След. страница" не найдена!');
                console.log('🔍 Ищем кнопку "След. глава"...');

                const nextChapterBtn = findNextChapterButton();
                if (nextChapterBtn) {
                    console.log('➡️ Переход на следующую главу');
                    nextChapterBtn.click();

                    console.log('⏳ Ожидание загрузки главы (8 секунд)...');
                    await sleep(8000);

                    waitingAfterPumpkin = false;
                    console.log('✅ Продолжаем поиск тыкв...');
                    console.log('📜 Начинаем прокрутку новой главы');
                    console.log('🔍 URL:', window.location.href);

                    // Запускаем следующую итерацию
                    setTimeout(() => {
                        console.log('🔄 Перезапуск цикла прокрутки...');
                        loop();
                    }, settings.scrollDelay);
                    return;
                } else {
                    console.log('⏹️ Кнопки не найдены, останавливаем читалку');
                    await stopReader();
                    return;
                }
            }
        }

        // Проверяем конец страницы (только если не ждем после тыквы и не нашли тыкву на этой итерации)
        if (!waitingAfterPumpkin && !foundPumpkin && isPageEnd()) {
            console.log('📖 Достигнут конец страницы (без тыквы)');

            // Ждем немного и переходим на следующую страницу
            const waitTime = randomInt(2000, 5000);
            console.log(`⏳ Ожидание ${Math.round(waitTime / 1000)} секунд...`);
            await sleep(waitTime);

            // Ищем кнопку следующей страницы
            const nextPageBtn = findNextPageButton();

            if (nextPageBtn) {
                console.log('➡️ Переход на следующую страницу...');
                nextPageBtn.click();

                // Ждем загрузки новой страницы (увеличена задержка)
                console.log('⏳ Ожидание загрузки страницы (8 секунд)...');
                await sleep(8000);

                console.log('✅ Новая страница загружена');
                console.log('📜 Запускаем прокрутку...');
                console.log('🔍 URL:', window.location.href);

                // Запускаем следующую итерацию
                setTimeout(() => {
                    console.log('🔄 Перезапуск цикла прокрутки...');
                    loop();
                }, settings.scrollDelay);
                return;
            } else {
                // Если нет кнопки страницы, ищем следующую главу
                const nextChapterBtn = findNextChapterButton();
                if (nextChapterBtn) {
                    console.log('➡️ Переход на следующую главу...');
                    nextChapterBtn.click();

                    console.log('⏳ Ожидание загрузки главы (8 секунд)...');
                    await sleep(8000);

                    console.log('✅ Новая глава загружена');
                    console.log('📜 Запускаем прокрутку...');
                    console.log('🔍 URL:', window.location.href);

                    // Запускаем следующую итерацию
                    setTimeout(() => {
                        console.log('🔄 Перезапуск цикла прокрутки...');
                        loop();
                    }, settings.scrollDelay);
                    return;
                } else {
                    console.log('⏹️ Кнопки не найдены, останавливаем читалку');
                    await stopReader();
                    return;
                }
            }
        }

        // Прокручиваем вниз (только если не ждем после тыквы и не нашли тыкву)
        if (!waitingAfterPumpkin && !foundPumpkin) {
            await scrollDown(settings.scrollSpeed);
        }

        // Продолжаем цикл
        setTimeout(loop, settings.scrollDelay);
    }

    loop();
}

async function stopReader() {
    isRunning.reader = false;
    waitingAfterPumpkin = false;

    // Сохраняем что читалка остановлена
    await chrome.storage.local.set({ readerActive: false });

    console.log('⏸ Остановка читалки');
}

// ============================================
// КВИЗ
// ============================================

// Загрузка базы ответов
let quizAnswers = null;
let newQuestions = {}; // Для сбора новых вопросов

async function loadQuizAnswers() {
    if (quizAnswers) return quizAnswers;

    try {
        const response = await fetch(chrome.runtime.getURL('quiz-answers.json'));
        quizAnswers = await response.json();
        console.log(`📚 Загружено ${Object.keys(quizAnswers).length} ответов для квиза`);
        return quizAnswers;
    } catch (error) {
        console.error('❌ Ошибка загрузки ответов квиза:', error);
        return null;
    }
}

function findQuizQuestion() {
    // Ищем текст вопроса по правильному классу
    const questionEl = document.querySelector('.quiz__question');

    if (questionEl) {
        return questionEl.textContent.trim();
    }

    return null;
}

function findQuizNumber() {
    // Находим номер текущего вопроса
    const numberEl = document.querySelector('.quiz__title-number');

    if (numberEl) {
        const text = numberEl.textContent.trim();
        const match = text.match(/\d+/);
        return match ? parseInt(match[0]) : null;
    }

    return null;
}

function findQuizAnswers() {
    // Ищем варианты ответов по правильному классу
    const answerButtons = document.querySelectorAll('.quiz__answer-item.button');

    if (answerButtons.length > 0) {
        return Array.from(answerButtons).map(btn => ({
            element: btn,
            text: btn.textContent.trim()
        }));
    }

    return [];
}

// Функция для определения правильного ответа после клика
function detectCorrectAnswer() {
    // Ищем результат квиза (правильный/неправильный)
    const resultEl = document.querySelector('.quiz__result, [class*="quiz-result"]');
    if (!resultEl) return null;

    const resultText = resultEl.textContent.toLowerCase();
    const isCorrect = resultText.includes('правильно') || resultText.includes('верно');

    // Ищем выбранный ответ (у него должен быть класс active или selected)
    const selectedAnswer = document.querySelector('.quiz__answer-item.active, .quiz__answer-item.selected, .quiz__answer-item[data-selected="true"]');

    return {
        isCorrect,
        selectedAnswer: selectedAnswer ? selectedAnswer.textContent.trim() : null
    };
}

// Сохранение нового вопроса
function saveNewQuestion(question, answers, attemptedAnswer = null, isCorrect = null) {
    const questionKey = question.toLowerCase().trim();

    // Если вопроса еще нет в новых
    if (!newQuestions[questionKey]) {
        newQuestions[questionKey] = {
            question: question,
            answers: answers.map(a => a.text),
            attempts: [],
            foundCorrect: false,
            correct_text: null
        };
        console.log('📝 Новый вопрос записан для изучения');
    }

    // Добавляем попытку ответа
    if (attemptedAnswer && isCorrect !== null) {
        newQuestions[questionKey].attempts.push({
            answer: attemptedAnswer,
            isCorrect: isCorrect
        });

        if (isCorrect) {
            newQuestions[questionKey].correct_text = attemptedAnswer;
            newQuestions[questionKey].foundCorrect = true;
            console.log(`✅ Найден правильный ответ: "${attemptedAnswer}"`);

            // Отправляем вопрос для сохранения
            chrome.runtime.sendMessage({
                action: 'saveNewQuestion',
                data: {
                    question: question,
                    answers: answers.map(a => a.text),
                    correct_text: attemptedAnswer
                }
            });
        } else {
            console.log(`❌ Неправильный ответ: "${attemptedAnswer}"`);
        }
    }

    // Показываем статистику собранных вопросов
    const totalNew = Object.keys(newQuestions).length;
    const withCorrect = Object.values(newQuestions).filter(q => q.foundCorrect).length;
    console.log(`📊 Собрано новых вопросов: ${totalNew} (с ответами: ${withCorrect})`);
}

function findCorrectAnswer(question, answers) {
    if (!quizAnswers) {
        console.log('⚠️ База ответов не загружена');
        // Сохраняем как новый вопрос
        saveNewQuestion(question, answers);
        // Пробуем угадать
        const randomAnswer = answers[randomInt(0, answers.length - 1)];
        return randomAnswer;
    }

    // Ищем вопрос в базе
    for (let key in quizAnswers) {
        const quiz = quizAnswers[key];

        // Проверяем совпадение вопроса (точное или частичное)
        const questionMatch = quiz.question === question ||
            quiz.question.includes(question) ||
            question.includes(quiz.question);

        if (questionMatch) {
            console.log(`✅ Найден ответ в базе: "${quiz.correct_text}"`);

            // Ищем соответствующий ответ среди кнопок
            for (let answer of answers) {
                const answerText = answer.text.toLowerCase().trim();
                const correctText = quiz.correct_text.toLowerCase().trim();

                // Проверяем точное совпадение или включение
                if (answerText === correctText ||
                    answerText.includes(correctText) ||
                    correctText.includes(answerText)) {
                    return answer;
                }
            }

            // Если точного совпадения нет, ищем по массиву всех ответов
            if (quiz.answers && Array.isArray(quiz.answers)) {
                for (let correctVariant of quiz.answers) {
                    for (let answer of answers) {
                        const answerText = answer.text.toLowerCase().trim();
                        const variantText = correctVariant.toLowerCase().trim();

                        if (answerText === variantText ||
                            answerText.includes(variantText) ||
                            variantText.includes(answerText)) {
                            // Проверяем что это правильный вариант
                            if (correctVariant.toLowerCase() === quiz.correct_text.toLowerCase()) {
                                return answer;
                            }
                        }
                    }
                }
            }
        }
    }

    // Вопрос не найден в базе!
    console.log('❌ Вопрос не найден в базе!');
    console.log('📝 Записываем как новый вопрос...');

    // Сохраняем как новый вопрос
    saveNewQuestion(question, answers);

    // Пробуем угадать (выбираем случайный)
    console.log('🎲 Пробуем угадать... (случайный выбор)');
    const randomAnswer = answers[randomInt(0, answers.length - 1)];
    return randomAnswer;
}

async function startQuiz() {
    if (isRunning.quiz) {
        console.log('Квиз уже работает');
        return;
    }

    isRunning.quiz = true;
    console.log('▶ Запуск квиза...');

    // Загружаем базу ответов
    await loadQuizAnswers();

    if (!quizAnswers) {
        console.error('❌ Не удалось загрузить базу ответов!');
        stopQuiz();
        return;
    }

    let correctAnswers = 0;
    const TARGET_ANSWERS = 11;
    let lastQuestionNumber = 0;

    async function answerQuestion() {
        if (!isRunning.quiz || correctAnswers >= TARGET_ANSWERS) {
            if (correctAnswers >= TARGET_ANSWERS) {
                console.log(`🎉 Квиз завершен! Правильных ответов: ${correctAnswers}`);
                stats.quizCompleted++;
                await saveStats();
            }
            stopQuiz();
            return;
        }

        // Ждем случайное время (думаем)
        const thinkTime = randomInt(2000, 5000);
        console.log(`🤔 Думаем ${Math.round(thinkTime / 1000)} секунд...`);
        await sleep(thinkTime);

        // Находим номер вопроса
        const questionNumber = findQuizNumber();
        if (questionNumber) {
            console.log(`📋 Вопрос #${questionNumber}`);

            // Если номер вопроса вернулся к 1, значит начали заново (неправильный ответ)
            if (lastQuestionNumber > 1 && questionNumber === 1) {
                console.log('❌ Неправильный ответ! Квиз начался заново.');
                correctAnswers = 0;
            }

            lastQuestionNumber = questionNumber;
        }

        // Находим вопрос
        const question = findQuizQuestion();
        if (!question) {
            console.log('⚠️ Вопрос не найден, ждем...');
            setTimeout(answerQuestion, 2000);
            return;
        }

        console.log(`❓ Вопрос: "${question}"`);

        // Находим варианты ответов
        const answers = findQuizAnswers();
        if (answers.length === 0) {
            console.log('⚠️ Варианты ответов не найдены, ждем...');
            setTimeout(answerQuestion, 2000);
            return;
        }

        console.log(`📝 Найдено ${answers.length} вариантов ответа:`);
        answers.forEach((a, i) => console.log(`   ${i + 1}. ${a.text}`));

        // Находим правильный ответ
        const correctAnswer = findCorrectAnswer(question, answers);

        if (correctAnswer) {
            console.log(`✅ Выбран ответ: "${correctAnswer.text}"`);

            // Кликаем на ответ
            correctAnswer.element.click();

            // Ждем результата проверки ответа
            await sleep(randomInt(1500, 2500));

            // Проверяем правильность ответа
            const result = detectCorrectAnswer();

            if (result && result.selectedAnswer) {
                console.log(`🔍 Результат: ${result.isCorrect ? '✅ Правильно' : '❌ Неправильно'}`);

                // Сохраняем результат попытки
                saveNewQuestion(question, answers, correctAnswer.text, result.isCorrect);

                if (result.isCorrect) {
                    correctAnswers++;
                    console.log(`📊 Прогресс: ${correctAnswers}/${TARGET_ANSWERS}`);
                } else {
                    // Если неправильно - квиз начнется заново
                    console.log('❌ Ответ неверный, квиз перезапустится');
                    correctAnswers = 0;
                }
            } else {
                // Если не удалось определить результат - считаем что правильно
                correctAnswers++;
                console.log(`📊 Прогресс: ${correctAnswers}/${TARGET_ANSWERS}`);
            }

            // Ждем следующий вопрос
            await sleep(randomInt(3000, 5000));
            setTimeout(answerQuestion, 1000);
        } else {
            console.log('❌ Не удалось найти ответ');
            setTimeout(answerQuestion, 2000);
        }
    }

    answerQuestion();
}

function stopQuiz() {
    isRunning.quiz = false;
    console.log('⏸ Остановка квиза');
}

// ============================================
// ОБРАБОТКА СООБЩЕНИЙ
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Получено сообщение:', message.action);

    // Используем async для корректной обработки
    (async () => {
        try {
            switch (message.action) {
                case 'ping':
                    sendResponse({ success: true, message: 'pong' });
                    break;

                case 'startMine':
                    await startMine(message);
                    sendResponse({ success: true });
                    break;

                case 'stopMine':
                    await stopMine();
                    sendResponse({ success: true });
                    break;

                case 'startComments':
                    await startComments(message);
                    sendResponse({ success: true });
                    break;

                case 'stopComments':
                    stopComments();
                    sendResponse({ success: true });
                    break;

                case 'startReader':
                    await startReader(message);
                    sendResponse({ success: true });
                    break;

                case 'stopReader':
                    await stopReader();
                    sendResponse({ success: true });
                    break;

                case 'startQuiz':
                    await startQuiz();
                    sendResponse({ success: true });
                    break;

                case 'stopQuiz':
                    stopQuiz();
                    sendResponse({ success: true });
                    break;

                case 'stopAll':
                    await stopMine();
                    stopComments();
                    await stopReader();
                    stopQuiz();
                    sendResponse({ success: true });
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('❌ Ошибка:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();

    return true; // Важно для асинхронного ответа
});

// Инициализация при загрузке страницы
(async () => {
    // Загружаем статистику
    await loadStats();

    // Проверяем нужно ли автоматически продолжить шахту
    const { mineActive, mineSettings } = await chrome.storage.local.get(['mineActive', 'mineSettings']);

    if (mineActive && mineSettings) {
        console.log('🔄 Продолжаем работу шахты после перезагрузки страницы...');

        // Небольшая задержка для полной загрузки страницы
        await sleep(1500);

        // Запускаем шахту с сохраненными настройками
        await startMine(mineSettings);
    }

    // Проверяем нужно ли автоматически продолжить читалку
    const { readerActive, readerSettings } = await chrome.storage.local.get(['readerActive', 'readerSettings']);

    if (readerActive && readerSettings) {
        console.log('🔄 Продолжаем работу читалки после перезагрузки страницы...');
        console.log('🔍 Текущий URL:', window.location.href);
        console.log('⚙️ Настройки читалки:', readerSettings);

        // Небольшая задержка для полной загрузки страницы
        await sleep(2000);

        // Запускаем читалку с сохраненными настройками
        await startReader(readerSettings);
    } else if (readerActive) {
        console.log('⚠️ readerActive = true, но настройки не найдены');
    }

    console.log('✅ MangaBuff Helper готов к работе!');
})();
