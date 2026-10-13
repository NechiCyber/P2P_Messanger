const express = require('express');
const app = express();
const path = require('path');

const PORT = 8080;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/users', (req, res) => {
    res.sendFile(path.join(__dirname, 'extra/users.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);
});
