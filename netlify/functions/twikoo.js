// ============================================================================
// 这是你的 twikoo fork 里 netlify/functions/twikoo.js 的**替换全文**。
// 把 GitHub 上该文件的内容整个换成下面这段，Commit → Netlify 自动重新部署即可。
// 不需要改 package.json，不需要改环境变量，不需要 Clear cache。
// ============================================================================
//
// 为什么需要这段补丁（2026-09-21 定位）：
//
//   1. Twikoo 前端（twikoo.all.min.js 2.0.x）浏览器分支固定这样发请求：
//        xhr.open('POST', envId)
//        xhr.setRequestHeader('Content-Type', 'application/json')
//      —— 只要 Content-Type 不是 application/x-www-form-urlencoded /
//      multipart/form-data / text/plain，浏览器就**必须先发 OPTIONS 预检**。
//
//   2. 后端 @twikoojs/common 的 pipeline 本来是对的：先 allowCors(request, config)
//      把 Access-Control-* 算进 headers，再对 OPTIONS 返回
//        { status: 204, body: {}, headers }        ← headers 里带着 CORS
//
//   3. 但适配器 twikoo-netlify@2.0.5 的 fromTkResponse() 在 204 分支写死了：
//        if (tkRes.status === 204) return { statusCode: 204, headers: {}, body: '' }
//      —— 把上一步算好的 CORS 头**全部丢掉**。
//
//   4. 结果：OPTIONS 预检响应成了「光板 204」，没有 Access-Control-Allow-Origin，
//      浏览器判定预检失败（fetch 抛 TypeError: Failed to fetch / xhr.status === 0），
//      Twikoo 前端遂显示「请求被跨域策略拦截 / status 0」。
//      ——注意 POST 本身是好的（带 CORS 头），所以 curl 直接 POST 能通、
//        只有真实浏览器会被拦，极易误判成「站点权限 / 白名单」问题。
//
// 实测对照（Chrome 无头，页面源 http://127.0.0.1:4399）：
//   A 204 不带 CORS 头 → BLOCKED (TypeError: Failed to fetch)   ← 复刻 2.0.5 现状
//   B 204 带   CORS 头 → HTTP 200 {"code":0,"version":"2.0.5",…} ← 本补丁
//   C 用 Content-Type: text/plain（不触发预检）直发 POST → HTTP 200
//
// 上游状态：twikoojs/twikoo main 分支 packages/server-netlify/src/main.ts
// 仍是同一个写法；对应单测只断言 statusCode===204 / body===''，没断言 headers，
// 所以这个 bug 一直没被测出来。（可去 GitHub 提 issue 反馈。）
// 官方修好后，本文件可以直接改回：
//   exports.handler = require('twikoo-netlify').handler
// ============================================================================

const { handler } = require('twikoo-netlify')

// 与 @twikoojs/common 的 allowCors() 产出的头保持一致
// （逐字对齐 twikoo-func 里的默认列表；额外补上 X-Request-Id 以防上游前端改回带该头的写法）
const CORS_HEADERS = {
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers':
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Request-Id',
  'Access-Control-Max-Age': '600',
}

exports.handler = async (event, context) => {
  const res = await handler(event, context)

  // 只处理被 fromTkResponse() 剥光头部的 204 预检响应；
  // 业务响应原样透传（它本来就带 CORS 头，别动）。
  if (res && res.statusCode === 204) {
    const h = event.headers || {}
    const origin = h.origin || h.Origin || ''

    res.headers = Object.assign({}, res.headers, CORS_HEADERS)

    // 默认策略与上游一致：未在 Twikoo 后台配置 CORS_ALLOW_ORIGIN 白名单时回显 Origin（即放行）。
    // ⚠️ 如果你以后在 Twikoo 管理面板里填了 CORS_ALLOW_ORIGIN，
    //    这里会绕过白名单——届时请把下面这行改成只放行白名单内的 Origin。
    if (origin) res.headers['Access-Control-Allow-Origin'] = origin
  }

  return res
}
