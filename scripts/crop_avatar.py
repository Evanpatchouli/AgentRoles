from PIL import Image
image = Image.open('screenshots/e2e-avatar.png')
crop = image.crop((790, 325, 1255, 448))
crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
crop.save('docs/assets/avatar.png')
print('saved', crop.size)
