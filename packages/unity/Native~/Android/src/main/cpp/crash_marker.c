#include <jni.h>
#include <signal.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <string.h>
#include <errno.h>
#include <sys/ucontext.h>

// No allocation, JNI, logging, locks, unwinding or network work in the handler.
static const int fatal_signals[] = { SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGTRAP };
static struct sigaction previous[6];
static int marker_fd = -1;
static volatile sig_atomic_t installed = 0;
static volatile sig_atomic_t recording = 0;
static void write_marker(const uint8_t record[16]) {
    if (marker_fd < 0) return;
    lseek(marker_fd, 0, SEEK_SET);
    ssize_t written = write(marker_fd, record, 16);
    (void)written;
}
static void marker_handler(int signal_number, siginfo_t *info, void *context);
static uintptr_t fault_pc(void *context) {
    if (context == 0) return 0;
    ucontext_t *uc = (ucontext_t *)context;
#if defined(__aarch64__)
    return (uintptr_t)uc->uc_mcontext.pc;
#elif defined(__arm__)
    return (uintptr_t)uc->uc_mcontext.arm_pc;
#elif defined(__x86_64__)
    return (uintptr_t)uc->uc_mcontext.gregs[REG_RIP];
#elif defined(__i386__)
    return (uintptr_t)uc->uc_mcontext.gregs[REG_EIP];
#else
    (void)uc;
    return 0;
#endif
}
// After a prior handler returns, is our handler still installed with nothing
// pending? Android's debuggerd resets the disposition and re-queues the signal
// before returning, and abort() re-raises: those stay fatal.
static int still_ours(int signal_number) {
    struct sigaction current;
    if (sigaction(signal_number, 0, &current) != 0) return 0;
    if (!(current.sa_flags & SA_SIGINFO) || current.sa_sigaction != marker_handler) return 0;
    sigset_t pending;
    return sigpending(&pending) == 0 && !sigismember(&pending, signal_number);
}
static int hardware_fault(int signal_number, const siginfo_t *info) {
    return (signal_number == SIGSEGV || signal_number == SIGBUS || signal_number == SIGFPE) && info != 0 && info->si_code > 0;
}
static void marker_handler(int signal_number, siginfo_t *info, void *context) {
    int saved_errno = errno;
    struct timespec now;
    uint8_t record[16] = { 'R', 'J', 'U', '1' };
    uint32_t number = (uint32_t)signal_number;
    uint64_t timestamp = 0;
    if (clock_gettime(CLOCK_REALTIME, &now) == 0) timestamp = (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
    for (int i = 0; i < 4; i++) record[4 + i] = (uint8_t)(number >> (i * 8));
    for (int i = 0; i < 8; i++) record[8 + i] = (uint8_t)(timestamp >> (i * 8));
    if (recording) write_marker(record);
    int index = -1;
    for (int i = 0; i < 6; i++) if (fatal_signals[i] == signal_number) index = i;
    if (index >= 0) {
        // Chain with the original siginfo and context. Re-raising would lose the
        // fault address, so a runtime that recovers from faults (Mono turns managed
        // null dereferences into NullReferenceException) would abort instead.
        const struct sigaction *prior = &previous[index];
        uintptr_t pc = fault_pc(context);
        if ((prior->sa_flags & SA_SIGINFO) && prior->sa_sigaction) {
            prior->sa_sigaction(signal_number, info, context);
        } else if (!(prior->sa_flags & SA_SIGINFO) && prior->sa_handler != SIG_DFL && prior->sa_handler != SIG_IGN) {
            prior->sa_handler(signal_number);
        } else {
            goto terminate;
        }
        if (hardware_fault(signal_number, info) && still_ours(signal_number)) {
            // A repaired fault resumes elsewhere (Mono redirects the program counter
            // to throw NullReferenceException): not a crash. Returning without a
            // repair would fault again forever, so treat that as the crash it is.
            if (pc == 0 || fault_pc(context) == pc) goto terminate;
            static const uint8_t cleared[16] = { 0 };
            if (recording) write_marker(cleared);
        }
        errno = saved_errno;
        return;
    }
terminate:
    {
        struct sigaction fallback; memset(&fallback, 0, sizeof(fallback));
        fallback.sa_handler = SIG_DFL; sigemptyset(&fallback.sa_mask);
        sigaction(signal_number, &fallback, 0);
        sigset_t unblocked; sigemptyset(&unblocked); sigaddset(&unblocked, signal_number); sigprocmask(SIG_UNBLOCK, &unblocked, 0);
        raise(signal_number);
        _exit(128 + signal_number);
    }
}
JNIEXPORT jboolean JNICALL Java_com_rejourney_UnityCrashMarker_install(JNIEnv *env, jclass cls, jstring path) {
    (void)cls;
    if (installed) { recording = 1; return JNI_TRUE; }
    const char *utf = (*env)->GetStringUTFChars(env, path, 0);
    marker_fd = open(utf, O_CREAT | O_WRONLY | O_TRUNC | O_CLOEXEC, 0600);
    (*env)->ReleaseStringUTFChars(env, path, utf);
    if (marker_fd < 0) return JNI_FALSE;
    struct sigaction action; memset(&action, 0, sizeof(action));
    action.sa_sigaction = marker_handler; action.sa_flags = SA_SIGINFO | SA_ONSTACK; sigemptyset(&action.sa_mask);
    for (int i = 0; i < 6; i++) sigaction(fatal_signals[i], &action, &previous[i]);
    installed = 1; recording = 1;
    return JNI_TRUE;
}
JNIEXPORT void JNICALL Java_com_rejourney_UnityCrashMarker_uninstall(JNIEnv *env, jclass cls) {
    (void)env; (void)cls;
    // Keep one process-lifetime descriptor and chain. A handler installed after
    // ours may call into us, so teardown must not close/reuse the descriptor or
    // install ourselves a second time ahead of that chain.
    recording = 0;
}
JNIEXPORT void JNICALL Java_com_rejourney_UnityCrashMarker_deliberateCrash(JNIEnv *env, jclass cls) { (void)env; (void)cls; raise(SIGABRT); }
