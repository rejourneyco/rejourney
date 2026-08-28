#include "RejourneySignalSupport.h"

#include <fcntl.h>
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

static void rj_signal_handler(int signal_number) {
    if (rj_handling_signal) _exit(128 + signal_number);
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

    int index = rj_index_for_signal(signal_number);
    if (index >= 0 && rj_previous_action_valid[index]) {
        (void)sigaction(signal_number, &rj_previous_actions[index], NULL);
    } else {
        struct sigaction default_action;
        memset(&default_action, 0, sizeof(default_action));
        default_action.sa_handler = SIG_DFL;
        sigemptyset(&default_action.sa_mask);
        (void)sigaction(signal_number, &default_action, NULL);
    }

    // A signal is blocked on the handling thread until its handler returns.
    // We do not return (the process is crashing), so explicitly unblock it
    // before re-delivery; otherwise a previously installed crash reporter or
    // the default action would never receive the original fatal signal.
    sigset_t unblocked;
    sigemptyset(&unblocked);
    sigaddset(&unblocked, signal_number);
    (void)sigprocmask(SIG_UNBLOCK, &unblocked, NULL);
    (void)kill(getpid(), signal_number);
    _exit(128 + signal_number);
}

int32_t rj_install_signal_handler(const char *path) {
    if (path == NULL || path[0] == '\0') return -1;
    if (rj_signal_handlers_active) rj_uninstall_signal_handler();

    rj_marker_fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (rj_marker_fd < 0) return -1;

    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = rj_signal_handler;
    sigemptyset(&action.sa_mask);
    action.sa_flags = 0;

    for (size_t index = 0; index < rj_signal_count; index++) {
        struct sigaction current_action;
        if (sigaction(rj_signals[index], NULL, &current_action) != 0) {
            rj_uninstall_signal_handler();
            return -1;
        }
        if (current_action.sa_handler == rj_signal_handler) continue;
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
            current_action.sa_handler == rj_signal_handler) {
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
