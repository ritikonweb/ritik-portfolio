Add-Type -AssemblyName System.Drawing
$code = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;

public static class GridMask {
    public static void Build(string basePath, string outPath, int threshold) {
        Bitmap bmp = new Bitmap(basePath);
        int w = bmp.Width, h = bmp.Height;
        BitmapData data = bmp.LockBits(new Rectangle(0,0,w,h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = Math.Abs(data.Stride);
        byte[] buffer = new byte[stride*h];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buffer, 0, buffer.Length);
        bmp.UnlockBits(data); bmp.Dispose();
        bool[] bg = new bool[w*h];
        bool[] visited = new bool[w*h];
        Stack<int> stack = new Stack<int>();
        for (int x=0;x<w;x++){ Push(stack,visited,x,0,w,h); Push(stack,visited,x,h-1,w,h); }
        for (int y=0;y<h;y++){ Push(stack,visited,0,y,w,h); Push(stack,visited,w-1,y,w,h); }
        while(stack.Count>0){
            int idx=stack.Pop(); int x=idx%w; int y=idx/w; int p=y*stride+x*4;
            if (buffer[p]<threshold || buffer[p+1]<threshold || buffer[p+2]<threshold) continue;
            bg[idx]=true;
            Push(stack,visited,x-1,y,w,h); Push(stack,visited,x+1,y,w,h);
            Push(stack,visited,x,y-1,w,h); Push(stack,visited,x,y+1,w,h);
        }
        // erode background by 3px away from subject so grid keeps a small margin off the body
        bool[] eroded = (bool[])bg.Clone();
        int margin = 4;
        for (int y=0;y<h;y++) for(int x=0;x<w;x++){
            int idx=y*w+x;
            if (!bg[idx]) continue;
            bool nearSubject=false;
            for(int dy=-margin;dy<=margin && !nearSubject;dy++) for(int dx=-margin;dx<=margin;dx++){
                int nx=x+dx, ny=y+dy;
                if(nx<0||ny<0||nx>=w||ny>=h) continue;
                if(!bg[ny*w+nx]){ nearSubject=true; break; }
            }
            if(nearSubject) eroded[idx]=false;
        }
        Bitmap mask = new Bitmap(w,h,PixelFormat.Format32bppArgb);
        BitmapData md = mask.LockBits(new Rectangle(0,0,w,h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        int mstride = Math.Abs(md.Stride);
        byte[] mbuf = new byte[mstride*h];
        double fadeTop = 0.46*h, fadeBottom = 0.60*h;
        for (int y=0;y<h;y++){
            double f = 1.0;
            if (y >= fadeBottom) f = 0.0; else if (y > fadeTop) f = 1.0 - (y - fadeTop)/(fadeBottom - fadeTop);
            for(int x=0;x<w;x++){
                int idx=y*w+x; int p=y*mstride+x*4;
                double a = eroded[idx] ? 255.0*f : 0.0;
                byte v = (byte)Math.Max(0, Math.Min(255, (int)Math.Round(a)));
                mbuf[p]=255; mbuf[p+1]=255; mbuf[p+2]=255; mbuf[p+3]=v;
            }
        }
        System.Runtime.InteropServices.Marshal.Copy(mbuf, 0, md.Scan0, mbuf.Length);
        mask.UnlockBits(md);
        mask.Save(outPath, ImageFormat.Png); mask.Dispose();
    }
    static void Push(Stack<int> s, bool[] v, int x, int y, int w, int h){
        if (x<0||y<0||x>=w||y>=h) return;
        int idx=y*w+x; if (v[idx]) return; v[idx]=true; s.Push(idx);
    }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[GridMask]::Build((Resolve-Path 'public/images/Base_image_desktop.png').Path, (Join-Path (Get-Location) 'public/images/hero-grid-mask.png'), 208)
Write-Output 'Grid mask generated'
