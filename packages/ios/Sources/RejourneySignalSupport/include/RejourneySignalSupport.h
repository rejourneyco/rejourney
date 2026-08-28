#ifndef REJOURNEY_SIGNAL_SUPPORT_H
#define REJOURNEY_SIGNAL_SUPPORT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int32_t rj_install_signal_handler(const char *path);
void rj_uninstall_signal_handler(void);
typedef void (*rj_exception_callback)(void *exception);
void rj_install_exception_handler(rj_exception_callback callback);
void rj_uninstall_exception_handler(void);

#ifdef __cplusplus
}
#endif

#endif
