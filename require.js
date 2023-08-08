const http = require('http')
const fs = require('fs')
let downloadList = []
const async = require("async");
const request = require("request");
const path = require("path");
const sharp = require('sharp');

const imageSize = 100; // Size of each individual image (adjust as needed)
const gridSize = 15; // Number of images in each row and column
const outputSize = imageSize * gridSize;
const imagesPath = path.join(__dirname, 'images');
const outputImagePath = path.join(__dirname, 'combined.jpg');

fs.mkdirSync(imagesPath, { recursive: true })

// functions
const downloadImage = (src, dest) => {
    return new Promise((resolve, reject) => {
        request.head(src, (err, res, body) => {
            if (err) {
                return reject(err);
            }
            request(src)
                .pipe(fs.createWriteStream(dest))
                .on('close', () => {
                    resolve(dest);
                });
        });
    });
};


const combineImages = async () => {
    try {
        const imageFiles = fs.readdirSync(imagesPath)
        const resizedImages = await Promise.all(
            imageFiles.map(async (filename) => {
                const imagePath = path.join(imagesPath, filename);
                const image = await sharp(imagePath).resize(imageSize, imageSize).toBuffer()
                // const resizedImagePath = path.join(resizedImagesPath, filename);
                // fs.writeFileSync(resizedImagePath, image);
                return image
            })
        )
        // Calculate the dimensions of the combined image
        const combinedSize = gridSize * imageSize
        // Create a new image with white background
        const combinedImage = sharp({
            create: {
                width: combinedSize,
                height: combinedSize,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        })
        const compositeOperations = []
        // Composite the resized images onto the combined image
        resizedImages.forEach((imageBuffer, index) => {
            if (index >= gridSize * gridSize) {
                console.log('Image compositing complete.')
                return;
            }
            const row = Math.floor(index / gridSize)
            const col = index % gridSize
            compositeOperations.push({
                input: imageBuffer,
                top: row * imageSize,
                left: col * imageSize
            })
        })
        combinedImage.composite(compositeOperations)
        // Save the combined image
        await combinedImage.toFile(outputImagePath, { quality: 100, force: true })
        console.log('Images combined successfully.')
    } catch (error) {
        console.error('Error combining images:', error)
    }
}


http.get('http://localhost:3000/playlist/track/all?id=8612509110', function (res) {
    let json = ''
    res.on('data', function (chunk) {
        // console.log(chunk + '')
        json += chunk
    })

    res.on('end', function () {
        try {
            const playlistData = JSON.parse(json)
            const songs = playlistData.songs
            const downloadPromises = []

            for (let i = 0; i < songs.length; i++) {
                const al = songs[i]
                if (!downloadList.includes(al.al.picUrl)) {
                    downloadList.push(al.al.picUrl)
                    downloadPromises.push(downloadImage(al.al.picUrl, dest))
                }
            }

            async.each(
                downloadList,
                (url, callback) => {
                    retry(
                        (cb) => {
                            const filename = path.basename(url);
                            const dest = path.join(__dirname, 'images', filename);
                            downloadImage(url, dest, cb);
                        },
                        {
                            retries: 3, // Number of retry attempts
                            minTimeout: 1000, // Minimum delay between retries in milliseconds
                        },
                        callback
                    );
                },
                (err) => {
                    if (err) {
                        console.error('Error downloading images:', err)
                    } else {
                        console.log('All images downloaded successfully.')
                    }
                }
            )
        } catch (error) {
            console.error('Error parsing JSON: ', error)
        }
        // Function to combine images
        combineImages();
    })
})
