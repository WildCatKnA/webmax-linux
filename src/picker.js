console.log("Picker.js загружен");

if (window.electronAPI) {
    console.log("API найдено, отправляем ready...");
    window.electronAPI.sendReady();
} else {
    console.error("Критическая ошибка: electronAPI не найден! Проверьте preload.");
}

window.electronAPI.onShowSources((sources) => {
    console.log("Источники получены:", sources.length);
    const list = document.getElementById('list');
    list.innerHTML = ''; 
    sources.forEach(s => {
        const div = document.createElement('div');
        div.className = 'item';
        div.innerHTML = `<img src="${s.thumbnail}"><span>${s.name}</span>`;
        div.onclick = () => {
            console.log("Выбран источник:", s.id);
            window.electronAPI.selectSource(s.id);
        };
        list.appendChild(div);
    });
});

// Кнопка отмена
document.querySelector('button').onclick = () => {
    window.electronAPI.selectSource(null);
};
