const http = require('http')
const fs = require('fs')
let downloadList = []
const async = require("async");
const request = require("request");
const path = require("path");
const sharp = require('sharp');
const retry = require('retry');
// const gridSize = 10
const imageSize = 100; // Size of each individual image (adjust as needed)
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
                const imagePath = path.join(imagesPath, filename)
                const image = await sharp(imagePath).toBuffer()

                // const image = await sharp(imagePath).resize(imageSize, imageSize).toBuffer()
                // const resizedImagePath = path.join(resizedImagesPath, filename);
                // fs.writeFileSync(resizedImagePath, image);
                return image
            })
        )
        const gridSize = Math.floor(Math.sqrt(resizedImages.length)) // Number of images in each row and column

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
    } catch (error) {
        console.error('Error combining images:', error)
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

http.get('http://localhost:3000/playlist/track/all?id=8480608218', function (res) {
    let json = ''
    res.on('data', function (chunk) {
        // console.log(chunk + '')
        json += chunk
    })

    res.on('end', async function () {
        try {
            const playlistData = JSON.parse(json)
            const songs = playlistData.songs
            const downloadPromises = []

            // print total number of songs
            console.log("Total number of songs:", songs.length)

            // retry options
            const retryOptions = {
                retries: 20, // Number of retry attempts
                minTimeout: 10000, // Minimum delay between retries in milliseconds
            };

            for (let i = 0; i < songs.length; i++) {
                // if (downloadList.length >= gridSize * gridSize) {
                //     console.log('Image downloading complete.')
                //     break;
                // }
                const al = songs[i]
                if (!downloadList.includes(al.al.picUrl)) {
                    const filename = path.basename(al.al.picUrl)
                    const dest = path.join(__dirname, 'images', filename)
                    const resizedpicUrl = al.al.picUrl + '?param=100y100'
                    downloadList.push(al.al.picUrl)
                    // Retry downloadImage function with retry options
                    const operation = retry.operation(retryOptions);
                    operation.attempt(async (currentAttempt) => {
                        try {
                            downloadPromises.push(downloadImage(resizedpicUrl, dest))
                            // await downloadImage(resizedpicUrl, dest);
                            console.log('Downloading image number: ', downloadList.length);
                        } catch (err) {
                            if (operation.retry(err)) {
                                return;
                            }
                            console.error('Error downloading image: ', err);
                        }
                    });
                }
            }

            await Promise.all(downloadPromises)
            console.log('All images downloaded successfully.')

            await combineImages()
            console.log('Images combined successfully.')
        } catch (error) {
            console.error('Error parsing JSON: ', error)
        }
    })
}).on('error', function (error) {
    console.error('HTTP request error:', error)
})