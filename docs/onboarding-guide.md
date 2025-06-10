# Sokuji 用户引导功能

## 概述

Sokuji 现在包含了一个全面的首次用户引导系统，使用 `react-joyride` 库实现。这个功能帮助新用户了解和配置扩展的各项设置。

## 功能特性

### 自动触发
- 首次安装后自动启动引导
- 1秒延迟后开始，确保界面完全加载

### 引导步骤

引导包含以下关键步骤：

1. **欢迎界面** - 介绍 Sokuji 的功能
2. **设置面板** - 引导用户打开设置
3. **API 密钥配置** - 指导设置 OpenAI API 密钥
4. **系统指令** - 解释如何自定义系统指令
5. **音频设置** - 引导打开音频面板
6. **麦克风设置** - 选择输入设备
7. **扬声器设置** - 选择输出设备
8. **语音配置** - 配置语音设置和检测参数
9. **主界面介绍** - 展示主要功能区域
10. **完成** - 总结和后续提示

### 用户控制
- **跳过** - 用户可以随时跳过引导
- **导航** - 前进/后退按钮
- **重新开始** - 从设置面板重新启动引导

## 技术实现

### 核心组件

#### OnboardingContext
```typescript
interface OnboardingContextType {
  isOnboardingActive: boolean;
  currentStepIndex: number;
  steps: OnboardingStep[];
  startOnboarding: () => void;
  stopOnboarding: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipOnboarding: () => void;
  isFirstTimeUser: boolean;
  markOnboardingComplete: () => void;
}
```

#### Onboarding 组件
- 使用 `react-joyride` 库
- 自定义样式和主题
- 响应式设计
- 国际化支持

### 数据持久化
- 使用 `localStorage` 存储完成状态
- 版本控制支持更新时重新显示引导
- 存储键：`sokuji_onboarding_completed`

### 样式定制
- 主色调：`#007bff`
- 自定义工具提示样式
- 动画效果和过渡
- 响应式适配

## 配置选项

### 引导步骤配置
每个步骤包含：
- `target` - CSS 选择器
- `content` - 说明文本
- `title` - 步骤标题
- `placement` - 工具提示位置
- `spotlightClicks` - 是否允许点击高亮元素

### 样式配置
```typescript
styles: {
  options: {
    primaryColor: '#007bff',
    backgroundColor: '#ffffff',
    textColor: '#333333',
    overlayColor: 'rgba(0, 0, 0, 0.4)',
    spotlightShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
    beaconSize: 36,
    zIndex: 10000,
  }
}
```

## 国际化

支持的语言文本：
- `onboarding.back` - 返回按钮
- `onboarding.close` - 关闭按钮
- `onboarding.finish` - 完成按钮
- `onboarding.next` - 下一步按钮
- `onboarding.skip` - 跳过按钮
- `onboarding.restartTour` - 重新开始引导

## 使用方法

### 开发者
1. 引导会在首次访问时自动启动
2. 可以通过设置面板的"重新开始引导"按钮手动启动
3. 引导状态通过 Context API 管理

### 最终用户
1. 安装扩展后会自动看到引导
2. 可以跳过或完整完成引导
3. 可以从设置中重新查看引导

## 扩展和自定义

### 添加新步骤
在 `OnboardingContext.tsx` 中的 `onboardingSteps` 数组中添加新步骤：

```typescript
{
  target: '.new-element',
  content: '新功能的说明',
  title: '步骤标题',
  placement: 'bottom',
}
```

### 修改样式
在 `Onboarding.scss` 中添加自定义样式或修改 `Onboarding.tsx` 中的 styles 配置。

### 更新文本
在相应的语言文件中添加新的翻译键值对。

## 最佳实践

1. **简洁明了** - 每个步骤的说明应该简洁易懂
2. **逻辑顺序** - 按照用户的自然使用流程安排步骤
3. **可跳过** - 始终提供跳过选项
4. **响应式** - 确保在不同屏幕尺寸下正常工作
5. **版本控制** - 重大更新时更新版本号以重新显示引导

## 故障排除

### 常见问题

1. **引导不显示**
   - 检查 localStorage 中是否已标记为完成
   - 清除 `sokuji_onboarding_completed` 键

2. **目标元素找不到**
   - 确保 CSS 选择器正确
   - 检查元素是否已渲染

3. **样式问题**
   - 检查 z-index 设置
   - 确保没有 CSS 冲突

### 调试
在浏览器控制台中运行：
```javascript
localStorage.removeItem('sokuji_onboarding_completed');
```
然后刷新页面重新触发引导。 