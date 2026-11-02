export const club = {
  name: '电子俱乐部',
  founded: 1991,
  college: '物理与电子科学学院',
  intro:
    '电子俱乐部成立于1991年，是面向电子信息类专业学生的科技创新类社团，挂靠物理与电子科学学院。',
  mission:
    '社团致力于培养学生电子技术基本技能，包括电子焊接、仪器仪表使用、硬件电路设计与制作，激发学生对电子技术的兴趣，提升工程实践能力与创新能力。',
}
export const directions = [
  {
    no: '01',
    title: '电子焊接',
    en: 'SOLDERING',
    text: '从元器件识别到焊点连接，在动手操作中打好电子制作的基础。',
  },
  {
    no: '02',
    title: '仪器仪表',
    en: 'MEASUREMENT',
    text: '学习使用仪器仪表，在测量、观察与分析中理解电路的工作状态。',
  },
  {
    no: '03',
    title: '硬件设计',
    en: 'HARDWARE DESIGN',
    text: '从原理理解到电路设计，把理论知识落实到具体的工程问题。',
  },
  {
    no: '04',
    title: '电子制作',
    en: 'PROTOTYPING',
    text: '通过制作、调试与改进，让想法成为可以验证的电子作品。',
  },
]
export const contentSections = {
  news: {
    title: '新闻公告',
    en: 'NEWS & NOTICES',
    description: '关注社团动态，了解最新通知。',
    empty: '暂无新闻公告',
    note: '正式公告将在发布后展示于此。',
    unit: '公告',
    label: '公告列表',
    link: '/news',
  },
  activities: {
    title: '活动中心',
    en: 'ACTIVITIES',
    description: '从基础技能到创新实践，在动手中探索电子技术。',
    empty: '暂无近期活动',
    note: '活动安排确认后，将在这里发布。',
    unit: '活动',
    label: '活动列表',
    link: '/activities',
  },
  community: {
    title: '电子社区',
    en: 'COMMUNITY',
    description: '交流电路设计，分享调试思路，让每一次探索都能得到回应。',
    empty: '社区交流即将开放',
    note: '发帖、评论与交流功能仍在建设中，当前暂无帖子。',
    unit: '帖子',
    label: '社区讨论',
    link: '/community',
  },
} as const
export type ContentKind = keyof typeof contentSections
