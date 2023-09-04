const fs = require('fs');
const path = require('path');

function displayFolderStructure(folderPath, indent = '') {
    const items = fs.readdirSync(folderPath);
    for (const item of items) {
        const itemPath = path.join(folderPath, item);
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory()) {
            console.log(indent + `├── ${item}`);
            displayFolderStructure(itemPath, indent + '│   ');
        } else {
            console.log(indent + `└── ${item}`);
        }
    }
}

const mainFolderPath = __dirname; // Change this to your main folder path
console.log(`Folder Structure for ${mainFolderPath}:`);
displayFolderStructure(mainFolderPath);
