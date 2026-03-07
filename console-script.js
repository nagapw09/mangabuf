// Простой скрипт для вставки в консоль браузера (F12)
// Скопируйте весь код и вставьте в консоль на странице https://mangabuff.ru/mine

(function() {
    'use strict';

    console.log('🎮 MangaBuff Mine Auto-Clicker загружен!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // НАСТРОЙКИ (можете изменить)
    const CONFIG = {
        clickInterval: 500,        // Интервал между кликами (мс)
        randomDelay: true,         // Случайная задержка
        minDelay: 300,            // Мин. задержка (мс)
        maxDelay: 800,            // Макс. задержка (мс)
        maxClicks: 100,           // Максимум кликов (0 = бесконечно)
    };

    let isRunning = false;
    let clickCount = 0;

    // Поиск кнопки
    function findButton() {
        const selectors = [
            'button[class*="mine"]',
            'button[class*="click"]',
            'button[type="button"]',
        ];

        for (let selector of selectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) return btn;
        }

        // Поиск по тексту
        const allButtons = document.querySelectorAll('button');
        for (let btn of allButtons) {
            const text = btn.textContent.toLowerCase();
            if (text.includes('копать') || text.includes('mine') || 
                text.includes('рыть') || text.includes('клик')) {
                return btn;
            }
        }
        return null;
    }

    // Клик
    function click() {
        const btn = findButton();
        if (!btn) {
            console.error('❌ Кнопка не найдена!');
            stop();
            return false;
        }

        if (btn.disabled) {
            console.log('⏸️  Кнопка заблокирована');
            return false;
        }

        btn.click();
        clickCount++;
        console.log(`✅ Клик #${clickCount}`);

        if (CONFIG.maxClicks > 0 && clickCount >= CONFIG.maxClicks) {
            console.log(`🎉 Достигнут лимит: ${CONFIG.maxClicks} кликов`);
            stop();
            return false;
        }

        return true;
    }

    // Запуск
    function start() {
        if (isRunning) {
            console.log('⚠️  Уже запущено!');
            return;
        }

        isRunning = true;
        clickCount = 0;
        console.log('🚀 Запуск автокликера...');

        click();

        function schedule() {
            if (!isRunning) return;
            
            const delay = CONFIG.randomDelay 
                ? Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay + 1)) + CONFIG.minDelay
                : CONFIG.clickInterval;

            setTimeout(() => {
                if (isRunning) {
                    click();
                    schedule();
                }
            }, delay);
        }

        schedule();
    }

    // Остановка
    function stop() {
        if (!isRunning) {
            console.log('⚠️  Уже остановлено!');
            return;
        }
        isRunning = false;
        console.log(`⏹️  Остановлено. Всего кликов: ${clickCount}`);
    }

    // Экспорт в window
    window.autoClicker = { start, stop, config: CONFIG };

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📖 КОМАНДЫ:');
    console.log('  autoClicker.start()  - запустить');
    console.log('  autoClicker.stop()   - остановить');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('💡 Пример: autoClicker.start()');

})();



