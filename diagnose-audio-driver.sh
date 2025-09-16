#!/bin/bash

# Sokuji Virtual Audio Driver 诊断脚本

echo "================================"
echo "  Sokuji Virtual Audio 诊断工具"
echo "================================"
echo ""

# 1. 检查 driver 是否安装
echo "1. 检查 driver 安装状态："
if [ -d "/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver" ]; then
    echo "   ✅ Driver 已安装到正确位置"
else
    echo "   ❌ Driver 未找到"
    exit 1
fi
echo ""

# 2. 检查文件权限
echo "2. 检查文件权限："
OWNER=$(stat -f %Su:%Sg /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver)
if [ "$OWNER" = "root:wheel" ]; then
    echo "   ✅ 权限正确 (root:wheel)"
else
    echo "   ⚠️  权限可能不正确: $OWNER (应该是 root:wheel)"
fi
echo ""

# 3. 检查二进制文件
echo "3. 检查二进制文件："
BINARY="/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver/Contents/MacOS/SokujiVirtualAudio"
if [ -f "$BINARY" ]; then
    echo "   ✅ 二进制文件存在"
    file "$BINARY" | grep -q "Mach-O" && echo "   ✅ 是有效的 macOS 二进制文件"

    # 检查架构
    if file "$BINARY" | grep -q "arm64"; then
        echo "   ✅ 支持 Apple Silicon (arm64)"
    fi
    if file "$BINARY" | grep -q "x86_64"; then
        echo "   ✅ 支持 Intel (x86_64)"
    fi
else
    echo "   ❌ 二进制文件不存在"
fi
echo ""

# 4. 检查音频设备列表
echo "4. 检查系统音频设备："
if system_profiler SPAudioDataType | grep -q "Sokuji"; then
    echo "   ✅ Sokuji 设备已出现在系统中："
    system_profiler SPAudioDataType | grep -A 5 -i "sokuji"
else
    echo "   ❌ Sokuji 设备未在系统音频设备中"
    echo ""
    echo "   其他虚拟音频设备："
    system_profiler SPAudioDataType | grep -E "BlackHole|Palabra|Loopback|Soundflower" || echo "   没有找到其他虚拟音频设备"
fi
echo ""

# 5. 尝试手动重启 CoreAudio
echo "5. 重启 CoreAudio 服务："
echo "   需要管理员密码来重启 CoreAudio..."
sudo killall coreaudiod 2>/dev/null && echo "   ✅ CoreAudio 已重启" || echo "   ⚠️  无法重启 CoreAudio"
echo ""

# 等待一下让 driver 加载
sleep 2

# 6. 再次检查
echo "6. 重启后再次检查："
if system_profiler SPAudioDataType | grep -q "Sokuji"; then
    echo "   ✅ Sokuji 设备现在已加载！"
else
    echo "   ❌ Sokuji 设备仍未加载"
    echo ""
    echo "   可能的原因："
    echo "   • Driver 的 CFBundleIdentifier 或签名问题"
    echo "   • macOS 安全设置阻止了未签名的 driver"
    echo "   • Driver 二进制文件与 Info.plist 不匹配"
    echo "   • 需要重启 Mac"
fi
echo ""

# 7. 检查系统日志
echo "7. 检查系统日志中的错误："
echo "   最近的 CoreAudio 相关日志："
log show --predicate 'subsystem == "com.apple.audio"' --last 1m 2>/dev/null | grep -i "error\|fail\|sokuji" | tail -5 || echo "   无法访问日志或没有相关错误"
echo ""

# 8. 提供建议
echo "================================"
echo "  诊断建议"
echo "================================"
echo ""
echo "如果 driver 仍未加载，请尝试："
echo ""
echo "1. 重启 Mac（最可靠的方法）"
echo ""
echo "2. 手动加载 driver："
echo "   sudo launchctl kickstart -k system/com.apple.audio.coreaudiod"
echo ""
echo "3. 检查系统安全设置："
echo "   系统设置 > 隐私与安全性 > 查看是否有被阻止的软件"
echo ""
echo "4. 使用原版 BlackHole driver："
echo "   如果 Sokuji driver 持续无法工作，可以考虑使用原版 BlackHole"
echo ""