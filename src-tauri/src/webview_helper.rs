use std::{cell::RefCell, ptr::NonNull, sync::Arc};

use objc2::{
    define_class, msg_send, rc::Retained, runtime::{AnyObject, ProtocolObject}, DefinedClass,
    MainThreadMarker, MainThreadOnly,
};
use objc2_core_foundation::{CGPoint, CGRect};
use objc2_foundation::{
    NSDictionary, NSNotification, NSNotificationCenter, NSNotificationName, NSObject,
    NSObjectProtocol, NSString, NSValue,
};
use objc2_ui_kit::{
    UIKeyboardDidShowNotification, UIKeyboardWillHideNotification, UIKeyboardWillShowNotification,
    UIScrollView, UIScrollViewContentInsetAdjustmentBehavior, UIScrollViewDelegate,
};
use tauri::WebviewWindow;

thread_local! {
    static KEYBOARD_SCROLL_PREVENT_DELEGATE: RefCell<Option<Retained<KeyboardScrollPreventDelegate>>> = RefCell::new(None);
}

pub fn disable_scroll_on_keyboard_show(webview_window: &WebviewWindow) {
    let _ = webview_window.with_webview(|webview| unsafe {
        #[allow(deprecated)]
        let webview: &objc2_ui_kit::UIWebView = &*webview.inner().cast();
        let notification_center = NSNotificationCenter::defaultCenter();
        let scroll_view_arc = Arc::new(webview.scrollView());
        let old_delegate_arc = Arc::new(std::sync::Mutex::new(None));

        scroll_view_arc
            .setContentInsetAdjustmentBehavior(UIScrollViewContentInsetAdjustmentBehavior::Never);

        let keyboard_height_arc = Arc::new(std::sync::Mutex::new(0 as f64));

        let scroll_view_arc_observer = scroll_view_arc.clone();
        let old_delegate_arc_observer = old_delegate_arc.clone();
        create_observer(
            &notification_center,
            &UIKeyboardWillShowNotification,
            move |_notification| {
                let mut old_delegate = old_delegate_arc_observer.lock().unwrap();
                *old_delegate = scroll_view_arc_observer.delegate();

                let new_delegate = KeyboardScrollPreventDelegate::new(
                    MainThreadMarker::from(webview),
                    scroll_view_arc_observer.clone(),
                    scroll_view_arc_observer.contentOffset(),
                );

                KEYBOARD_SCROLL_PREVENT_DELEGATE.with(|cell| {
                    *cell.borrow_mut() = Some(new_delegate);
                });

                KEYBOARD_SCROLL_PREVENT_DELEGATE.with(|cell| {
                    if let Some(delegate) = cell.borrow().as_ref() {
                        let delegate_obj = ProtocolObject::from_ref(&**delegate);
                        webview.scrollView().setDelegate(Some(delegate_obj));
                    }
                });
            },
        );

        let scroll_view_arc_observer = scroll_view_arc.clone();
        let keyboard_height_arc_observer = keyboard_height_arc.clone();
        create_observer(
            &notification_center,
            &UIKeyboardWillHideNotification,
            move |_notification| {
                let mut frame = webview.frame();
                let keyboard_height = keyboard_height_arc_observer.lock().unwrap();
                frame.size.height += *keyboard_height;
                webview.setFrame(frame);

                let mut insets = scroll_view_arc_observer.contentInset();
                insets.bottom += *keyboard_height;
                scroll_view_arc_observer.setContentInset(insets);
            },
        );

        let scroll_view_arc_observer = scroll_view_arc.clone();
        let old_delegate_arc_observer = old_delegate_arc.clone();
        let keyboard_height_arc_observer = keyboard_height_arc.clone();
        create_observer(
            &notification_center,
            &UIKeyboardDidShowNotification,
            move |notification| {
                let user_info: *mut NSDictionary<NSString, AnyObject> =
                    msg_send![notification, userInfo];
                if user_info.is_null() {
                    return;
                }

                let key = NSString::from_str("UIKeyboardFrameEndUserInfoKey");
                let value: *mut NSValue = msg_send![user_info, objectForKey: &*key];
                if value.is_null() {
                    return;
                }

                let keyboard_rect: CGRect = msg_send![value, CGRectValue];

                let mut frame = webview.frame();
                let mut keyboard_height = keyboard_height_arc_observer.lock().unwrap();
                *keyboard_height = keyboard_rect.size.height;
                frame.size.height -= *keyboard_height;
                webview.setFrame(frame);

                let mut insets = scroll_view_arc_observer.contentInset();
                insets.bottom -= *keyboard_height;
                scroll_view_arc_observer.setContentInset(insets);

                let mut old_delegate = old_delegate_arc_observer.lock().unwrap();

                if let Some(delegate) = old_delegate.take() {
                    scroll_view_arc_observer.setDelegate(Some(delegate.as_ref()));
                } else {
                    scroll_view_arc_observer.setDelegate(None);
                }
            },
        );
    });
}

pub struct KeyboardScrollPreventDelegateState {
    pub scroll_view: Arc<Retained<UIScrollView>>,
    pub offset: CGPoint,
}

define_class! {
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "KeyboardScrollPreventDelegate"]
    #[ivars = KeyboardScrollPreventDelegateState]
    pub(crate) struct KeyboardScrollPreventDelegate;

    unsafe impl NSObjectProtocol for KeyboardScrollPreventDelegate {}

    unsafe impl UIScrollViewDelegate for KeyboardScrollPreventDelegate {
        #[unsafe(method(scrollViewDidScroll:))]
        unsafe fn scroll_view_did_scroll(&self, _scroll_view: &UIScrollView) {
            unsafe {
                self.ivars().scroll_view.setContentOffset(self.ivars().offset);
            }
        }
    }
}

impl KeyboardScrollPreventDelegate {
    fn new(
        mtm: MainThreadMarker,
        scroll_view: Arc<Retained<UIScrollView>>,
        offset: CGPoint,
    ) -> Retained<Self> {
        let delegate = Self::alloc(mtm).set_ivars(KeyboardScrollPreventDelegateState {
            scroll_view,
            offset,
        });

        unsafe { msg_send![super(delegate), init] }
    }
}

fn create_observer(
    center: &NSNotificationCenter,
    name: &NSNotificationName,
    handler: impl Fn(&NSNotification) + 'static,
) -> Retained<ProtocolObject<dyn NSObjectProtocol>> {
    let block = block2::RcBlock::new(move |notification: NonNull<NSNotification>| {
        handler(unsafe { notification.as_ref() });
    });

    unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) }
}
