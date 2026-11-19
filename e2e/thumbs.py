import hashlib, io
from PIL import Image, ImageDraw, ImageFilter
def thumb(vid, w=1280, h=720):
    hsh = hashlib.md5(vid.encode()).digest()
    import colorsys
    hue = hsh[0]/255
    c1 = tuple(int(x*255) for x in colorsys.hsv_to_rgb(hue, .55, .55))
    c2 = tuple(int(x*255) for x in colorsys.hsv_to_rgb((hue+.12)%1, .7, .95))
    img = Image.new('RGB', (w, h), c1)
    d = ImageDraw.Draw(img)
    for i in range(6):
        x = hsh[i+1]/255*w; y = hsh[i+7]/255*h; r = 80 + hsh[i+3]
        d.ellipse([x-r, y-r, x+r, y+r], fill=c2 if i%2 else tuple(min(255,v+40) for v in c1))
    d.rectangle([0, h*0.72, w, h], fill=tuple(v//3 for v in c1))
    img = img.filter(ImageFilter.GaussianBlur(28))
    b = io.BytesIO(); img.save(b, 'JPEG', quality=80); return b.getvalue()
