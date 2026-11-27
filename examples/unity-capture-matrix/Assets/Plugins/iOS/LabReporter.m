// A stand-in for another crash reporter (Crashlytics, the engine's own): records what
// its signal handler was given, then hands the signal to whoever was installed before it.
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

static const int lab_signals[] = { SIGSEGV, SIGABRT, SIGBUS };
static struct sigaction lab_previous[3];
static int lab_fd = -1;

static void lab_write(const char *text) { (void)write(lab_fd, text, strlen(text)); }
static void lab_write_hex(uint64_t value) {
    char buffer[19] = "0x0000000000000000"; const char *digits = "0123456789abcdef";
    for (int i = 0; i < 16; i++) buffer[17 - i] = digits[(value >> (i * 4)) & 0xf];
    (void)write(lab_fd, buffer, 18);
}
static void lab_handler(int number, siginfo_t *info, void *context) {
    if (lab_fd >= 0) {
        lab_write("signal="); lab_write_hex((uint64_t)number);
        lab_write(" code="); lab_write_hex(info ? (uint64_t)(uint32_t)info->si_code : 0xffff);
        lab_write(" address="); lab_write_hex(info ? (uint64_t)(uintptr_t)info->si_addr : 0);
        lab_write(pthread_main_np() ? " thread=main\n" : " thread=other\n");
    }
    for (int i = 0; i < 3; i++) {
        if (lab_signals[i] != number) continue;
        struct sigaction previous = lab_previous[i];
        (void)sigaction(number, &previous, 0);
        if ((previous.sa_flags & SA_SIGINFO) && previous.sa_sigaction) previous.sa_sigaction(number, info, context);
        else if (!(previous.sa_flags & SA_SIGINFO) && previous.sa_handler != SIG_DFL && previous.sa_handler != SIG_IGN) previous.sa_handler(number);
    }
}
void lab_install_reporter(const char *path) {
    lab_fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    struct sigaction action; memset(&action, 0, sizeof(action));
    action.sa_sigaction = lab_handler; action.sa_flags = SA_SIGINFO; sigemptyset(&action.sa_mask);
    for (int i = 0; i < 3; i++) (void)sigaction(lab_signals[i], &action, &lab_previous[i]);
}
