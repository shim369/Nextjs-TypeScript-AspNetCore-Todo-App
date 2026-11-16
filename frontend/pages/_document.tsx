import { Html, Head, Main, NextScript } from 'next/document'

// 保存済みテーマを描画前に適用(ちらつき防止)
const themeScript = `(function(){try{var t=localStorage.getItem('todo-theme');if(t){document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#0c0e16':'#eeeeee');}}catch(e){}})();`

export default function Document() {
  return (
    <Html lang="en" data-theme="light">
      <Head>
        <meta name="description" content="A to-do list app built with Next.js and an ASP.NET Core Web API." />
        <meta name="theme-color" content="#eeeeee" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
