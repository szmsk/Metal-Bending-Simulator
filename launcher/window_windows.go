//go:build windows

package main

import (
    "os/exec"
    "syscall"
)

func hideChildWindow(cmd *exec.Cmd) {
    cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func openBrowser(url string) error {
    cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
    hideChildWindow(cmd)
    return cmd.Start()
}
