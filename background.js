// Background Service Worker

console.log('🔧 MangaBuff Helper Background Service загружен');

// Слушаем установку расширения
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('🎉 Расширение установлено!');
        
        // Устанавливаем дефолтные настройки
            chrome.storage.local.set({
                mineDelayMin: 1000,
                mineDelayMax: 3000,
                mineMaxClicks: 100,
                commentCount: 10,
                commentDelayMin: 30000, // 30 секунд (фиксированная)
                scrollSpeed: 10,
                scrollDelay: 300,
                pumpkinLeft: true,
                mineClicks: 0,
                commentsSent: 0,
                pumpkinsFound: 0,
                pumpkinsToday: 0,
                quizCompleted: 0
            });
    } else if (details.reason === 'update') {
        console.log('🔄 Расширение обновлено до версии', chrome.runtime.getManifest().version);
    }
});

// Хранилище для новых собранных вопросов
let collectedQuestions = [];

// Загружаем сохраненные вопросы при запуске
chrome.storage.local.get(['collectedQuestions'], (result) => {
    if (result.collectedQuestions) {
        collectedQuestions = result.collectedQuestions;
        console.log(`📚 Загружено ${collectedQuestions.length} собранных вопросов`);
    }
});

// Обработка сообщений от content scripts и popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Получено сообщение в background:', message);

    if (message.action === 'updateStats') {
        sendResponse({ success: true });
    }
    
    // Сохранение нового вопроса
    if (message.action === 'saveNewQuestion') {
        const { question, answers, correct_text } = message.data;
        
        // Проверяем что такого вопроса еще нет
        const exists = collectedQuestions.some(q => q.question === question);
        
        if (!exists) {
            const newQuestion = {
                question,
                answers,
                correct_text,
                timestamp: Date.now(),
                source: 'auto-collected'
            };
            
            collectedQuestions.push(newQuestion);
            
            // Сохраняем в storage
            chrome.storage.local.set({ collectedQuestions }, () => {
                console.log(`✅ Сохранен новый вопрос: "${question}"`);
                console.log(`   Правильный ответ: "${correct_text}"`);
                console.log(`   Всего собрано: ${collectedQuestions.length}`);
            });
            
            sendResponse({ success: true, total: collectedQuestions.length });
        } else {
            console.log(`⚠️ Вопрос уже существует: "${question}"`);
            sendResponse({ success: false, reason: 'already_exists' });
        }
    }
    
    // Получение всех собранных вопросов
    if (message.action === 'getCollectedQuestions') {
        sendResponse({ 
            success: true, 
            questions: collectedQuestions,
            total: collectedQuestions.length
        });
    }
    
    // Очистка собранных вопросов
    if (message.action === 'clearCollectedQuestions') {
        collectedQuestions = [];
        chrome.storage.local.set({ collectedQuestions: [] }, () => {
            console.log('🗑️ Собранные вопросы очищены');
            sendResponse({ success: true });
        });
    }
    
    // Экспорт собранных вопросов
    if (message.action === 'exportCollectedQuestions') {
        const dataStr = JSON.stringify(collectedQuestions, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        chrome.downloads.download({
            url: url,
            filename: `mangabuff-questions-${Date.now()}.json`,
            saveAs: true
        }, (downloadId) => {
            console.log(`📥 Экспорт вопросов начат (ID: ${downloadId})`);
            sendResponse({ success: true, downloadId });
        });
    }

    return true;
});
