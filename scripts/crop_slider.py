from PIL import Image
image = Image.open('screenshots/slider.png')
crop = image.crop((320, 512, 1310, 618))
crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
crop.save('docs/assets/range.png')
print('saved', crop.size)
