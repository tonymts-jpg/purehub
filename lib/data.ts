import { CreatorProfile, Notification, Post, Product, Transaction } from "./types";

const galleryAlts = [
  "主视觉人物肖像", "角色全身造型", "环境氛围画面", "人物侧面构图",
  "场景互动瞬间", "服装造型特写", "创作过程记录", "自然神态近景",
  "道具与材质细节", "幕后准备画面", "人物情绪特写", "作品收尾画面"
];

const createPostMedia = (postId:string, title:string) =>
  galleryAlts.map((description,index)=>({
    id:`${postId}-media-${index+1}`,
    src:`/generated/posts/${postId}/${String(index+1).padStart(2,"0")}.webp`,
    alt:`${title} — ${description}`,
    width:720,
    height:900,
    order:index+1
  }));

export const creators: CreatorProfile[] = [
  { id:"c1", name:"林夕 Yuki", handle:"yuki", avatar:"夕", role:"creator", bio:"Cosplay 造型师与角色摄影博主，分享服装制作、妆造细节与完整主题企划。", category:"Cosplay", followers:128400, members:2438, cover:"cover-1", verified:true, plans:[
    {id:"p11",name:"旅人",price:18,color:"#ff7b75",benefits:["每周高清套图","造型制作动态","会员徽章"]},
    {id:"p12",name:"造梦者",price:48,color:"#a865d7",benefits:["包含旅人权益","幕后花絮","每月直播"]},
    {id:"p13",name:"星图收藏家",price:98,color:"#6559df",benefits:["全部权益","限定主题企划","作品署名鸣谢"]}
  ]},
  { id:"c2", name:"陈默", handle:"chenmo", avatar:"默", role:"creator", bio:"专注鞋履、美足与生活方式摄影，用光影记录优雅线条和细腻质感。", category:"美足", followers:86500, members:1280, cover:"cover-2", verified:true, plans:[
    {id:"p21",name:"观景席",price:15,color:"#ff7b75",benefits:["无水印套图","布光笔记"]},
    {id:"p22",name:"暗房会员",price:42,color:"#a865d7",benefits:["调色预设","幕后花絮","月度直播"]},
    {id:"p23",name:"城市合伙人",price:88,color:"#6559df",benefits:["全部权益","限定写真集","线下活动优先"]}
  ]},
  { id:"c3", name:"Momo Studio", handle:"momo", avatar:"M", role:"creator", bio:"以角色关系、情境演绎与戏剧化叙事为核心的成人向主题工作室。", category:"調教", followers:74200, members:937, cover:"cover-3", verified:true, plans:[
    {id:"p31",name:"旁观席",price:12,color:"#ff7b75",benefits:["主题预告","角色设定"]},
    {id:"p32",name:"幕后通行证",price:39,color:"#a865d7",benefits:["情境脚本","制作日志","主题投票"]},
    {id:"p33",name:"联合策划人",price:108,color:"#6559df",benefits:["全部权益","企划署名","限量周边"]}
  ]},
  { id:"c4", name:"空山映像", handle:"kongshan", avatar:"山", role:"creator", bio:"在山野、海岸与城市边缘完成自然光人像和旅行主题创作。", category:"戶外", followers:45900, members:682, cover:"cover-4", verified:true, plans:[] },
  { id:"c5", name:"六月私语", handle:"june", avatar:"六", role:"creator", bio:"面向成年观众的私密美学、情绪写真与创作手记。", category:"R18", followers:39200, members:510, cover:"cover-5", verified:false, plans:[
    {id:"p51",name:"夜读者",price:20,color:"#ff7b75",benefits:["每周成熟主题预览","会员徽章","创作手记"]},
    {id:"p52",name:"私语会员",price:56,color:"#a865d7",benefits:["完整高清图集","幕后手记","主题投票"]},
    {id:"p53",name:"深夜收藏家",price:118,color:"#6559df",benefits:["全部权益","限定企划","作品署名鸣谢"]}
  ] },
  { id:"c6", name:"角色造梦局", handle:"gameclub", avatar:"梦", role:"creator", bio:"从游戏、电影与原创设定中还原角色，记录每次变身的完整过程。", category:"Cosplay", followers:92100, members:1560, cover:"cover-6", verified:true, plans:[] }
];

const titles = [
  ["雾港巡游：完整造型公开","从服装打版到夜景拍摄，记录这套原创角色的诞生。","Cosplay"],
  ["缎面高跟鞋光影练习","用柔光呈现鞋履、足部线条与材质细节。","美足"],
  ["红丝绒房间：角色规则","会员限定的情境设定、角色关系与幕后手记。","調教"],
  ["雨后竹林写真日记","沿着山路寻找雾气、逆光与最自然的表情。","戶外"],
  ["午夜私语 Vol.01","仅面向成年观众的氛围写真与创作随笔。","R18"],
  ["机械姬妆造拆解","金属质感妆容、假发修剪与道具制作全过程。","Cosplay"],
  ["赤足与晨光","清晨窗边的自然光、美足姿态与构图练习。","美足"],
  ["主题企划：服从与反转","从服装、场景到表演节奏的完整企划说明。","調教"],
  ["海岸线的风","冬日海边外拍，记录风、浪与低饱和色彩。","戶外"],
  ["暗房来信 Vol.02","成年会员专属的私密主题预览与拍摄札记。","R18"],
  ["月面研究员 Cosplay","低重力温室角色设定与完整高清套图。","Cosplay"],
  ["黑色绑带鞋造型集","围绕鞋履与足部配饰完成的极简时尚主题。","美足"],
  ["黑白房间幕后记录","角色引导、灯光调度与安全边界的制作记录。","調教"],
  ["旧车站外拍计划","在废弃站台完成一组电影感旅行写真。","戶外"],
  ["深夜红光主题","R18 分级的成人美学企划与会员限定花絮。","R18"],
  ["狐面祭典造型册","和风角色服装、面具道具与夜间灯光测试。","Cosplay"],
  ["雨夜鞋履调色预设","一套针对霓虹街景与足部特写的调色方案。","美足"],
  ["山顶日出拍摄清单","器材、路线、天气判断与完整户外拍摄复盘。","戶外"]
] as const;

export const posts: Post[] = titles.map((item, i) => ({
  id:`post-${i+1}`, creatorId:`c${i%6+1}`, title:item[0], excerpt:item[1],
  content:"这是完整作品内容的 Demo 展示。博主可以在这里分享高清图集、创作过程、源文件说明与会员专属幕后故事。PureHub 将内容、社群与可持续收入放在同一个体验里。",
  cover:`cover-${i%6+1}`, category:item[2], tags:[item[2],"精选",i%2?"幕后":"灵感"],
  visibility:i%5===3?"purchase":i%4===2?"members":"free", price:i%5===3?28:undefined,
  likes:860+i*137, comments:[{id:`cm-${i}`,user:"小北",text:"氛围和细节都太棒了，期待下一篇！",time:"2小时前"}],
  createdAt:i<2?"今天":i<7?"本周":"6月",
  media:createPostMedia(`post-${i+1}`,item[0])
}));

export const products: Product[] = [
  {id:"pr1",creatorId:"c1",title:"《雾港巡游》4K 套图",price:36,cover:"cover-1"},
  {id:"pr2",creatorId:"c2",title:"鞋履写真调色预设",price:49,cover:"cover-2"},
  {id:"pr3",creatorId:"c3",title:"主题企划幕后手记",price:68,cover:"cover-3"}
];

export const transactions: Transaction[] = [
  {id:"t1",title:"造梦者会员收入",amount:48,type:"income",date:"今天 14:28",status:"已入账"},
  {id:"t2",title:"数字商品销售",amount:36,type:"income",date:"今天 11:05",status:"已入账"},
  {id:"t3",title:"旅人会员收入",amount:18,type:"income",date:"昨天",status:"待结算"},
  {id:"t4",title:"提现至支付宝",amount:-1200,type:"payout",date:"6月18日",status:"已完成"}
];

export const notifications: Notification[] = [
  {id:"n1",title:"你有一位新会员",body:"南风加入了「造梦者」会员。",time:"5分钟前",read:false,type:"member"},
  {id:"n2",title:"作品获得 100 个赞",body:"《雾港纪事》正在被更多人看见。",time:"1小时前",read:false,type:"like"},
  {id:"n3",title:"订阅续费成功",body:"你对林夕 Yuki 的支持已续费。",time:"昨天",read:true,type:"payment"},
  {id:"n4",title:"PureHub 博主周报",body:"本周收入较上周增长 18.4%。",time:"周一",read:true,type:"system"}
];

export const trendData = [
  {name:"4月",income:12800,members:1480},{name:"5月",income:16400,members:1760},
  {name:"6月",income:19380,members:2438}
];
