#include "RejourneySignalSupport.h"

#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

#import <Foundation/Foundation.h>

static NSUncaughtExceptionHandler *rj_previous_exception_handler = NULL;
static rj_exception_callback rj_exception_callback_function = NULL;
static int rj_previous_exception_handler_valid = 0;
static int rj_exception_handler_chained_externally = 0;

static void rj_exception_handler(NSException *exception) {
    if (rj_exception_callback_function != NULL) {
        rj_exception_callback_function((__bridge void *)exception);
    }
    if (rj_previous_exception_handler_valid && rj_previous_exception_handler != NULL) {
        rj_previous_exception_handler(exception);
    }
}

void rj_install_exception_handler(rj_exception_callback callback) {
    rj_exception_callback_function = callback;
    NSUncaughtExceptionHandler *current = NSGetUncaughtExceptionHandler();
    if (current == &rj_exception_handler || rj_exception_handler_chained_externally) return;
    rj_previous_exception_handler = current;
    rj_previous_exception_handler_valid = 1;
    NSSetUncaughtExceptionHandler(&rj_exception_handler);
}

void rj_uninstall_exception_handler(void) {
    if (NSGetUncaughtExceptionHandler() == &rj_exception_handler) {
        NSSetUncaughtExceptionHandler(rj_previous_exception_handler);
        rj_previous_exception_handler = NULL;
        rj_previous_exception_handler_valid = 0;
        rj_exception_handler_chained_externally = 0;
    } else if (rj_previous_exception_handler_valid) {
        // A later crash reporter may retain us as its previous handler. Keep
        // the predecessor chain intact while disabling Rejourney capture.
        rj_exception_handler_chained_externally = 1;
    }
    rj_exception_callback_function = NULL;
}


static const int rj_signals[] = { SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGTRAP };
static const size_t rj_signal_count = sizeof(rj_signals) / sizeof(rj_signals[0]);
static struct sigaction rj_previous_actions[6];
static int rj_previous_action_valid[6];
static int rj_signal_handlers_active = 0;
static int rj_marker_fd = -1;
static volatile sig_atomic_t rj_handling_signal = 0;

static int rj_index_for_signal(int signal_number) {
    for (size_t index = 0; index < rj_signal_count; index++) {
        if (rj_signals[index] == signal_number) return (int)index;
    }
    return -1;
}

static void rj_signal_handler(int signal_number, siginfo_t *info, void *context);

static int rj_is_ours(const struct sigaction *action) {
    return (action->sa_flags & SA_SIGINFO) && action->sa_sigaction == rj_signal_handler;
}

static void rj_restore_default(int signal_number) {
    struct sigaction default_action;
    memset(&default_action, 0, sizeof(default_action));
    default_action.sa_handler = SIG_DFL;
    sigemptyset(&default_action.sa_mask);
    (void)sigaction(signal_number, &default_action, NULL);
}

// Async-signal-safe only: no allocation, locks, Objective-C or unwinding.
static void rj_signal_handler(int signal_number, siginfo_t *info, void *context) {
    int saved_errno = errno;
    int index = rj_index_for_signal(signal_number);

    if (rj_handling_signal) {
        // A second fatal signal while the first is being handled, or a predecessor
        // that returned into the fault with this handler put back: stop chaining.
        rj_restore_default(signal_number);
        errno = saved_errno;
        return;
    }
    rj_handling_signal = 1;

    if (rj_marker_fd >= 0) {
        uint32_t value = (uint32_t)signal_number;
        const uint8_t marker[8] = {
            0x52, 0x4A, 0x53, 0x31,
            (uint8_t)(value & 0xff),
            (uint8_t)((value >> 8) & 0xff),
            (uint8_t)((value >> 16) & 0xff),
            (uint8_t)((value >> 24) & 0xff)
        };
        (void)lseek(rj_marker_fd, 0, SEEK_SET);
        (void)write(rj_marker_fd, marker, sizeof(marker));
    }

    // Hand the slot back to whoever held it before this handler, then call that
    // handler directly on the faulting thread with the original siginfo and
    // context. Sending the signal again (kill) would reach an arbitrary thread
    // with si_code SI_USER and no fault address, so a crash reporter installed
    // earlier (Crashlytics, the engine's own) would record the wrong crash.
    struct sigaction previous;
    memset(&previous, 0, sizeof(previous));
    previous.sa_handler = SIG_DFL;
    sigemptyset(&previous.sa_mask);
    if (index >= 0 && rj_previous_action_valid[index] && !rj_is_ours(&rj_previous_actions[index])) {
        previous = rj_previous_actions[index];
    }
    (void)sigaction(signal_number, &previous, NULL);

    if ((previous.sa_flags & SA_SIGINFO) && previous.sa_sigaction != NULL) {
        previous.sa_sigaction(signal_number, info, context);
    } else if (!(previous.sa_flags & SA_SIGINFO) && previous.sa_handler != SIG_DFL && previous.sa_handler != SIG_IGN) {
        previous.sa_handler(signal_number);
    } else if (signal_number == SIGABRT || info == NULL || info->si_code <= 0
               || info->si_code == SI_USER || info->si_code == SI_QUEUE) {
        // Default action for a signal that was sent (abort, raise, kill): deliver
        // it again to this thread. It stays blocked until this handler returns.
        (void)pthread_kill(pthread_self(), signal_number);
    }
    // A hardware fault runs its instruction again on return and now meets the
    // predecessor's or the default disposition, with the original context.
    errno = saved_errno;
}

int32_t rj_install_signal_handler(const char *path) {
    if (path == NULL || path[0] == '\0') return -1;
    if (rj_signal_handlers_active) rj_uninstall_signal_handler();

    rj_marker_fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (rj_marker_fd < 0) return -1;

    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_sigaction = rj_signal_handler;
    sigemptyset(&action.sa_mask);
    // SA_ONSTACK: a thread that set up an alternate stack can still report a
    // stack overflow. It is ignored on threads without one.
    action.sa_flags = SA_SIGINFO | SA_ONSTACK;

    for (size_t index = 0; index < rj_signal_count; index++) {
        struct sigaction current_action;
        if (sigaction(rj_signals[index], NULL, &current_action) != 0) {
            rj_uninstall_signal_handler();
            return -1;
        }
        if (rj_is_ours(&current_action)) continue;
        if (rj_previous_action_valid[index]) {
            // A later crash reporter owns the slot and may retain Rejourney as
            // its predecessor. Reinstalling above it could create a recursive
            // handler chain, so preserve that ownership.
            continue;
        }
        if (sigaction(rj_signals[index], &action, &rj_previous_actions[index]) != 0) {
            rj_uninstall_signal_handler();
            return -1;
        }
        rj_previous_action_valid[index] = 1;
    }

    rj_signal_handlers_active = 1;
    rj_handling_signal = 0;
    return 0;
}

void rj_uninstall_signal_handler(void) {
    for (size_t index = 0; index < rj_signal_count; index++) {
        struct sigaction current_action;
        if (sigaction(rj_signals[index], NULL, &current_action) == 0 &&
            rj_is_ours(&current_action)) {
            if (rj_previous_action_valid[index]) {
                (void)sigaction(rj_signals[index], &rj_previous_actions[index], NULL);
            }
            rj_previous_action_valid[index] = 0;
        }
    }
    rj_signal_handlers_active = 0;
    rj_handling_signal = 0;

    if (rj_marker_fd >= 0) {
        (void)close(rj_marker_fd);
        rj_marker_fd = -1;
    }
}
