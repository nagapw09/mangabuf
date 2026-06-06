// Popup.js - Логика интерфейса расширения

// Получение текущей вкладки
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

// Отправка сообщения в content script
async function sendMessage(action, data = {}) {
    try {
        const tab = await getCurrentTab();
        if (!tab.url.includes('mangabuff.ru')) {
            updateStatus('Откройте страницу mangabuff.ru', true);
            return;
        }

        // Пытаемся отправить сообщение с несколькими попытками
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action, ...data });
                return response;
            } catch (error) {
                attempts++;

                if (attempts === 1) {
                    // Первая попытка не удалась - инжектим скрипт
                    console.log('Content script не загружен, инжектим...');

                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content.js']
                    });
                }

                if (attempts < maxAttempts) {
                    // Ждем перед следующей попыткой (увеличиваем задержку с каждой попыткой)
                    await new Promise(resolve => setTimeout(resolve, 500 * attempts));
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        updateStatus('Ошибка: перезагрузите страницу', true);
    }
}

// Обновление статуса
function updateStatus(text, isError = false) {
    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');

    statusText.textContent = text;

    if (isError) {
        statusDot.classList.add('active');
    } else {
        statusDot.classList.remove('active');
    }
}

// Загрузка сохраненных настроек
async function loadSettings() {
    const settings = await chrome.storage.local.get({
        mineDelayMin: 300,
        mineDelayMax: 800,
        mineMaxClicks: 100,
        commentCount: 10,
        commentDelayMin: 30000, // 30 секунд (фиксированная)
        scrollSpeed: 5,
        scrollDelay: 500,
        pumpkinLeft: true
    });

    // Шахта
    document.getElementById('mineDelayMin').value = settings.mineDelayMin;
    document.getElementById('mineDelayMax').value = settings.mineDelayMax;

    // Комментарии (конвертируем мс в секунды для UI)
    document.getElementById('commentDelayMin').value = settings.commentDelayMin / 1000;

    // Переключатели комментариев
    if (settings.commentCount === 10) {
        document.getElementById('comments10').classList.add('active');
        document.getElementById('comments13').classList.remove('active');
    } else {
        document.getElementById('comments13').classList.add('active');
        document.getElementById('comments10').classList.remove('active');
    }

    // Читалка
    document.getElementById('scrollSpeed').value = settings.scrollSpeed;
    document.getElementById('scrollSpeedValue').textContent = settings.scrollSpeed;
    document.getElementById('scrollDelay').value = settings.scrollDelay;
    document.getElementById('pumpkinLeft').checked = settings.pumpkinLeft;
}

// Сохранение настроек
async function saveSettings() {
    const settings = {
        mineDelayMin: parseInt(document.getElementById('mineDelayMin').value),
        mineDelayMax: parseInt(document.getElementById('mineDelayMax').value),
        mineMaxClicks: 100, // Фиксированное значение
        commentCount: document.getElementById('comments10').classList.contains('active') ? 10 : 13,
        commentDelayMin: parseInt(document.getElementById('commentDelayMin').value) * 1000, // секунды → мс
        scrollSpeed: parseInt(document.getElementById('scrollSpeed').value),
        scrollDelay: parseInt(document.getElementById('scrollDelay').value),
        pumpkinLeft: document.getElementById('pumpkinLeft').checked
    };

    await chrome.storage.local.set(settings);
}

// Загрузка статистики
async function loadStats() {
    const stats = await chrome.storage.local.get({
        mineClicks: 0,
        commentsSent: 0,
        pumpkinsFound: 0,
        pumpkinsToday: 0,
        quizCompleted: 0
    });

    document.getElementById('mineBadge').textContent = stats.mineClicks;
    document.getElementById('commentBadge').textContent = stats.commentsSent;
    document.getElementById('quizBadge').textContent = stats.quizCompleted;

    // Показываем общий счетчик и дневной
    const pumpkinText = `${stats.pumpkinsToday}/35`;
    document.getElementById('readerPumpkins').textContent = pumpkinText;
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    // Сразу показываем интерфейс, загружаем данные асинхронно
    const statusBar = document.getElementById('statusBar');
    statusBar.classList.add('loading');
    updateStatus('Загрузка...');

    // Загружаем всё параллельно без блокировки UI
    Promise.all([
        loadSettings(),
        loadStats(),
        getCurrentTab()
    ]).then(([_, __, tab]) => {
        statusBar.classList.remove('loading');
        if (tab && tab.url && tab.url.includes('mangabuff.ru')) {
            updateStatus('Готово к работе');
        } else {
            updateStatus('Откройте mangabuff.ru', true);
        }
    }).catch(err => {
        statusBar.classList.remove('loading');
        console.error('Ошибка загрузки:', err);
        updateStatus('Ошибка загрузки');
    });

    // === ШАХТА ===
    document.getElementById('mineStart').addEventListener('click', async () => {
        await saveSettings();

        // Проверяем на какой странице мы
        const tab = await getCurrentTab();

        // Получаем настройки и сохраняем их
        const settings = await chrome.storage.local.get(['mineDelayMin', 'mineDelayMax', 'mineMaxClicks']);

        // Сохраняем что шахта должна быть активна
        await chrome.storage.local.set({
            mineActive: true,
            mineSettings: settings
        });

        // Если не на странице шахты - переходим туда
        if (!tab.url.includes('/mine')) {
            updateStatus('Переход на страницу шахты...');
            await chrome.tabs.update(tab.id, { url: 'https://mangabuff.ru/mine' });
            updateStatus('Шахта: запускается...');
        } else {
            // Уже на странице шахты - запускаем сразу
            await sendMessage('startMine', settings);
            updateStatus('Шахта: работает...');
        }
    });

    document.getElementById('mineStop').addEventListener('click', async () => {
        await sendMessage('stopMine');
        updateStatus('Шахта: остановлена');
    });

    // === КОММЕНТАРИИ ===
    // Переключатели 10/13
    document.getElementById('comments10').addEventListener('click', () => {
        document.getElementById('comments10').classList.add('active');
        document.getElementById('comments13').classList.remove('active');
        saveSettings();
    });

    document.getElementById('comments13').addEventListener('click', () => {
        document.getElementById('comments13').classList.add('active');
        document.getElementById('comments10').classList.remove('active');
        saveSettings();
    });

    document.getElementById('commentStart').addEventListener('click', async () => {
        await saveSettings();

        // Проверяем что на странице есть поле для комментариев
        const tab = await getCurrentTab();

        // Проверяем наличие формы комментариев на странице
        const hasCommentForm = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // Ищем textarea для комментариев
                const commentField = document.querySelector('textarea[placeholder*="нибудь"]') ||
                    document.querySelector('textarea[class*="comment"]') ||
                    document.querySelector('.comment-form textarea');
                return !!commentField;
            }
        });

        if (!hasCommentForm[0]?.result) {
            updateStatus('Форма комментариев не найдена!', true);
            alert('Пожалуйста, откройте страницу с формой комментариев');
            return;
        }

        const settings = await chrome.storage.local.get(['commentCount', 'commentDelayMin']);
        await sendMessage('startComments', settings);
        updateStatus('Комментарии: работает...');
    });

    document.getElementById('commentStop').addEventListener('click', async () => {
        await sendMessage('stopComments');
        updateStatus('Комментарии: остановлены');
    });

    // === ЧИТАЛКА ===
    // Слайдер скорости
    document.getElementById('scrollSpeed').addEventListener('input', (e) => {
        document.getElementById('scrollSpeedValue').textContent = e.target.value;
        saveSettings();
    });

    document.getElementById('readerStart').addEventListener('click', async () => {
        await saveSettings();

        // Проверяем что мы на странице чтения манги
        const tab = await getCurrentTab();
        if (!tab.url.includes('/manga/') && !tab.url.includes('/read/')) {
            updateStatus('Откройте страницу чтения манги!', true);
            alert('Пожалуйста, откройте страницу для чтения манги');
            return;
        }

        const settings = await chrome.storage.local.get([
            'scrollSpeed',
            'scrollDelay',
            'pumpkinLeft'
        ]);
        await sendMessage('startReader', settings);
        updateStatus('Читалка: работает...');
    });

    document.getElementById('readerStop').addEventListener('click', async () => {
        await sendMessage('stopReader');
        updateStatus('Читалка: остановлена');
    });

    // === КВИЗ ===
    document.getElementById('quizStart').addEventListener('click', async () => {
        const tab = await getCurrentTab();

        // Если не на странице квиза - переходим туда
        if (!tab.url.includes('/quiz')) {
            updateStatus('Переход на страницу квиза...');
            await chrome.tabs.update(tab.id, { url: 'https://mangabuff.ru/quiz' });

            // Ждем загрузки страницы
            await new Promise(resolve => {
                const listener = (tabId, changeInfo) => {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
                setTimeout(resolve, 5000);
            });

            // Даём больше времени на загрузку скрипта
            updateStatus('Страница загружена, запуск...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        await sendMessage('startQuiz');
        updateStatus('Квиз: работает...');
    });

    document.getElementById('quizStop').addEventListener('click', async () => {
        await sendMessage('stopQuiz');
        updateStatus('Квиз: остановлен');
    });

    // === БЫСТРЫЕ ДЕЙСТВИЯ ===
    document.getElementById('resetStats').addEventListener('click', async () => {
        const confirmed = confirm('Сбросить ВСЕ счетчики (включая дневной лимит тыкв)?');
        if (!confirmed) return;

        await chrome.storage.local.set({
            mineClicks: 0,
            commentsSent: 0,
            pumpkinsFound: 0,
            pumpkinsToday: 0,
            quizCompleted: 0
        });
        await loadStats();
        updateStatus('Счетчики сброшены');
    });



    // Автосохранение при изменении инпутов
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', saveSettings);
    });

    // Периодическое обновление статистики
    setInterval(loadStats, 1000);
});

// Слушаем сообщения от content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateStats') {
        loadStats();
    } else if (message.action === 'updateStatus') {
        updateStatus(message.text, message.isError);
    }
});

