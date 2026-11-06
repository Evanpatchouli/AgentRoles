from PIL import Image
image = Image.open('screenshots/light-chat.png')
crop = image.crop((955, 0, 1220, 46))
crop = crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS)
crop.save('docs/assets/theme-switch.png')
print('saved', crop.size)
