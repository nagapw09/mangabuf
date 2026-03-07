// ==UserScript==
// @name         MangaBuff Mine Auto-Clicker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Автоматизация кликов в шахте на mangabuff.ru
// @author       You
// @match        https://mangabuff.ru/mine*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Настройки
    const CONFIG = {
        autoStart: false,          // Автоматический старт при загрузке страницы
        clickInterval: 500,        // Интервал между кликами в миллисекундах (500ms = 0.5 секунды)
        randomDelay: true,         // Случайная задержка между кликами (более естественно)
        minDelay: 300,            // Минимальная задержка (если randomDelay = true)
        maxDelay: 800,            // Максимальная задержка (если randomDelay = true)
        maxClicks: 0,             // Максимальное количество кликов (0 = бесконечно)
        stopOnError: true         // Останавливать при ошибке
    };

    let isRunning = false;
    let clickCount = 0;
    let intervalId = null;

    // Функция для поиска кнопки (попробуем разные селекторы)
    function findMineButton() {
        // Попробуем разные варианты селекторов
        const selectors = [
            'button[class*="mine"]',
            'button[class*="click"]',
            'button[class*="dig"]',
            'button[type="button"]',
            '.mine-button',
            '#mine-button',
            '[onclick*="mine"]',
            'button:contains("Копать")',
            'button:contains("Рыть")',
            'button:contains("Добыть")',
        ];

        for (let selector of selectors) {
            try {
                const button = document.querySelector(selector);
                if (button && button.offsetParent !== null) { // Проверяем, что кнопка видима
                    return button;
                }
            } catch (e) {
                // Игнорируем ошибки с невалидными селекторами
            }
        }

        // Если не нашли по селекторам, ищем все кнопки и берем наиболее вероятную
        const allButtons = document.querySelectorAll('button');
        for (let button of allButtons) {
            const text = button.textContent.toLowerCase();
            if (text.includes('копать') || text.includes('рыть') || 
                text.includes('добыть') || text.includes('mine') || 
                text.includes('dig') || text.includes('клик')) {
                return button;
            }
        }

        return null;
    }

    // Функция для получения случайной задержки
    function getRandomDelay() {
        if (CONFIG.randomDelay) {
            return Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay + 1)) + CONFIG.minDelay;
        }
        return CONFIG.clickInterval;
    }

    // Функция для выполнения клика
    function performClick() {
        const button = findMineButton();
        
        if (!button) {
            console.error('[Auto-Clicker] Кнопка не найдена!');
            if (CONFIG.stopOnError) {
                stopClicker();
            }
            return false;
        }

        // Проверяем, не заблокирована ли кнопка
        if (button.disabled || button.hasAttribute('disabled')) {
            console.log('[Auto-Clicker] Кнопка заблокирована, пропускаем клик');
            return false;
        }

        // Выполняем клик
        button.click();
        clickCount++;
        console.log(`[Auto-Clicker] Клик #${clickCount}`);

        // Проверяем, достигнут ли лимит
        if (CONFIG.maxClicks > 0 && clickCount >= CONFIG.maxClicks) {
            console.log('[Auto-Clicker] Достигнут максимальный лимит кликов');
            stopClicker();
            return false;
        }

        return true;
    }

    // Функция для запуска кликера
    function startClicker() {
        if (isRunning) {
            console.log('[Auto-Clicker] Кликер уже запущен');
            return;
        }

        isRunning = true;
        clickCount = 0;
        console.log('[Auto-Clicker] Запуск автокликера...');
        updateControlPanel();

        // Первый клик сразу
        performClick();

        // Функция для следующего клика с задержкой
        function scheduleNextClick() {
            if (!isRunning) return;
            
            const delay = getRandomDelay();
            setTimeout(() => {
                if (isRunning) {
                    performClick();
                    scheduleNextClick();
                }
            }, delay);
        }

        scheduleNextClick();
    }

    // Функция для остановки кликера
    function stopClicker() {
        if (!isRunning) {
            console.log('[Auto-Clicker] Кликер уже остановлен');
            return;
        }

        isRunning = false;
        console.log(`[Auto-Clicker] Остановка автокликера. Всего кликов: ${clickCount}`);
        updateControlPanel();
    }

    // Создание панели управления
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'auto-clicker-panel';
        panel.innerHTML = `
            <div style="position: fixed; top: 10px; right: 10px; z-index: 10000; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        padding: 15px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                        font-family: Arial, sans-serif; color: white; min-width: 250px;">
                <div style="font-weight: bold; font-size: 16px; margin-bottom: 10px; 
                           text-align: center; border-bottom: 2px solid rgba(255,255,255,0.3); 
                           padding-bottom: 8px;">
                    ⛏️ Auto-Clicker
                </div>
                <div style="margin-bottom: 10px; font-size: 14px;">
                    <div style="margin-bottom: 5px;">
                        Статус: <span id="clicker-status" style="font-weight: bold;">Остановлен</span>
                    </div>
                    <div>
                        Кликов: <span id="clicker-count" style="font-weight: bold;">0</span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                    <button id="start-clicker-btn" style="flex: 1; padding: 8px; border: none; 
                           border-radius: 5px; background: #48bb78; color: white; cursor: pointer; 
                           font-weight: bold; transition: background 0.3s;">
                        ▶ Старт
                    </button>
                    <button id="stop-clicker-btn" style="flex: 1; padding: 8px; border: none; 
                           border-radius: 5px; background: #f56565; color: white; cursor: pointer; 
                           font-weight: bold; transition: background 0.3s;">
                        ⏸ Стоп
                    </button>
                </div>
                <div style="font-size: 11px; color: rgba(255,255,255,0.8); text-align: center; 
                           margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
                    Интервал: ${CONFIG.randomDelay ? `${CONFIG.minDelay}-${CONFIG.maxDelay}` : CONFIG.clickInterval}ms
                </div>
                <button id="toggle-panel-btn" style="position: absolute; top: 5px; right: 5px; 
                       background: rgba(255,255,255,0.2); border: none; color: white; 
                       border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;">
                    −
                </button>
            </div>
        `;
        document.body.appendChild(panel);

        // Добавляем обработчики событий
        document.getElementById('start-clicker-btn').addEventListener('click', startClicker);
        document.getElementById('stop-clicker-btn').addEventListener('click', stopClicker);
        
        // Кнопка для сворачивания панели
        const toggleBtn = document.getElementById('toggle-panel-btn');
        toggleBtn.addEventListener('click', () => {
            const panelContent = panel.querySelector('div');
            if (panelContent.style.display === 'none') {
                panelContent.style.display = 'block';
                toggleBtn.textContent = '−';
            } else {
                panelContent.style.display = 'none';
                toggleBtn.textContent = '+';
            }
        });

        // Hover эффекты для кнопок
        const startBtn = document.getElementById('start-clicker-btn');
        const stopBtn = document.getElementById('stop-clicker-btn');
        
        startBtn.addEventListener('mouseenter', () => startBtn.style.background = '#38a169');
        startBtn.addEventListener('mouseleave', () => startBtn.style.background = '#48bb78');
        stopBtn.addEventListener('mouseenter', () => stopBtn.style.background = '#e53e3e');
        stopBtn.addEventListener('mouseleave', () => stopBtn.style.background = '#f56565');
    }

    // Обновление информации на панели
    function updateControlPanel() {
        const statusEl = document.getElementById('clicker-status');
        const countEl = document.getElementById('clicker-count');
        
        if (statusEl) {
            statusEl.textContent = isRunning ? 'Работает' : 'Остановлен';
            statusEl.style.color = isRunning ? '#48bb78' : '#f56565';
        }
        
        if (countEl) {
            countEl.textContent = clickCount;
        }
    }

    // Горячие клавиши
    document.addEventListener('keydown', (e) => {
        // Ctrl + Shift + S - старт
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            startClicker();
        }
        // Ctrl + Shift + X - стоп
        if (e.ctrlKey && e.shiftKey && e.key === 'X') {
            e.preventDefault();
            stopClicker();
        }
    });

    // Инициализация
    function init() {
        console.log('[Auto-Clicker] Скрипт загружен');
        
        // Ждем, пока страница полностью загрузится
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(createControlPanel, 1000);
            });
        } else {
            setTimeout(createControlPanel, 1000);
        }

        // Автостарт, если включен
        if (CONFIG.autoStart) {
            setTimeout(startClicker, 2000);
        }
    }

    init();

    // Экспортируем функции в консоль для ручного управления
    window.mineAutoClicker = {
        start: startClicker,
        stop: stopClicker,
        getStatus: () => ({ isRunning, clickCount }),
        setConfig: (newConfig) => Object.assign(CONFIG, newConfig)
    };

    console.log('[Auto-Clicker] Доступные команды в консоли:');
    console.log('  mineAutoClicker.start() - запустить');
    console.log('  mineAutoClicker.stop() - остановить');
    console.log('  mineAutoClicker.getStatus() - получить статус');
    console.log('  mineAutoClicker.setConfig({...}) - изменить настройки');
    console.log('');
    console.log('Горячие клавиши:');
    console.log('  Ctrl + Shift + S - Старт');
    console.log('  Ctrl + Shift + X - Стоп');

})();



