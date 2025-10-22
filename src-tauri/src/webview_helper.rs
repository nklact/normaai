use std::{cell::RefCell, ptr::NonNull, sync::Arc};

use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, DefinedClass, MainThreadOnly,
};
use objc2_core_foundation::{CGPoint, CGRect};
use objc2_foundation::{
    MainThreadMarker, NSNotification, NSNotificationCenter, NSNotificationName,
    NSObject, NSObjectProtocol, NSString,
};
use objc2_ui_kit::{
    NSValueUIGeometryExtensions, UIColor,
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

        // Store original webview height and insets at startup
        let original_frame = webview.frame();
        let original_height_arc = Arc::new(original_frame.size.height);
        let original_insets = scroll_view_arc.contentInset();
        let original_bottom_inset_arc = Arc::new(original_insets.bottom);

        let keyboard_height_arc = Arc::new(std::sync::Mutex::new(0.0));

        // Set webview's superview background to white to prevent black flash during keyboard animations
        if let Some(superview) = webview.superview() {
            superview.setBackgroundColor(Some(&UIColor::whiteColor()));
        }

        // UIKeyboardWillShowNotification: Install scroll-preventing delegate
        let scroll_view_will_show = scroll_view_arc.clone();
        let old_delegate_will_show = old_delegate_arc.clone();
        create_observer(
            &notification_center,
            &UIKeyboardWillShowNotification,
            move |_notification| {
                let mut old_delegate = old_delegate_will_show.lock().unwrap();
                *old_delegate = scroll_view_will_show.delegate();

                // SAFETY: This callback is guaranteed to be called on the main thread
                let mtm = unsafe { MainThreadMarker::new_unchecked() };
                let new_delegate = KeyboardScrollPreventDelegate::new(
                    mtm,
                    scroll_view_will_show.clone(),
                    scroll_view_will_show.contentOffset(),
                );

                KEYBOARD_SCROLL_PREVENT_DELEGATE.with(|cell| {
                    *cell.borrow_mut() = Some(new_delegate);
                });

                KEYBOARD_SCROLL_PREVENT_DELEGATE.with(|cell| {
                    if let Some(delegate) = cell.borrow().as_ref() {
                        let delegate_obj: &ProtocolObject<dyn UIScrollViewDelegate> =
                            ProtocolObject::from_ref(&**delegate);
                        webview.scrollView().setDelegate(Some(delegate_obj));
                    }
                });
            },
        );

        // UIKeyboardDidShowNotification: Shrink webview by keyboard height
        let scroll_view_did_show = scroll_view_arc.clone();
        let keyboard_height_did_show = keyboard_height_arc.clone();
        let original_height_did_show = original_height_arc.clone();
        let original_bottom_inset_did_show = original_bottom_inset_arc.clone();
        create_observer(
            &notification_center,
            &UIKeyboardDidShowNotification,
            move |notification| {
                let user_info = match notification.userInfo() {
                    Some(info) => info,
                    None => return,
                };

                let key = NSString::from_str("UIKeyboardFrameEndUserInfoKey");
                let value = match user_info.objectForKey(&key) {
                    Some(v) => v,
                    None => return,
                };

                // Cast to NSValue and get CGRect using msg_send
                let keyboard_rect: CGRect = unsafe { msg_send![&*value, CGRectValue] };

                // Calculate from original height (not current frame) to prevent double-shrinking
                let mut frame = webview.frame();
                let mut keyboard_height = keyboard_height_did_show.lock().unwrap();
                *keyboard_height = keyboard_rect.size.height;
                frame.size.height = *original_height_did_show - *keyboard_height;
                webview.setFrame(frame);

                // Calculate from original inset (not current inset) to prevent double-shrinking
                let mut insets = scroll_view_did_show.contentInset();
                insets.bottom = *original_bottom_inset_did_show - *keyboard_height;
                scroll_view_did_show.setContentInset(insets);

                // Keep scroll-preventing delegate active until keyboard fully hides
                // (delegate restoration moved to UIKeyboardWillHideNotification)
            },
        );

        // UIKeyboardWillHideNotification: Restore original dimensions and delegate
        let scroll_view_will_hide = scroll_view_arc.clone();
        let original_height_will_hide = original_height_arc.clone();
        let original_bottom_inset_will_hide = original_bottom_inset_arc.clone();
        let old_delegate_will_hide = old_delegate_arc.clone();
        create_observer(
            &notification_center,
            &UIKeyboardWillHideNotification,
            move |_notification| {
                // Restore to original height (not current + keyboard)
                let mut frame = webview.frame();
                frame.size.height = *original_height_will_hide;
                webview.setFrame(frame);

                // Restore to original bottom inset (not current + keyboard)
                let mut insets = scroll_view_will_hide.contentInset();
                insets.bottom = *original_bottom_inset_will_hide;
                scroll_view_will_hide.setContentInset(insets);

                // Restore original scroll delegate when keyboard fully hides
                let mut old_delegate = old_delegate_will_hide.lock().unwrap();
                if let Some(delegate) = old_delegate.take() {
                    scroll_view_will_hide.setDelegate(Some(delegate.as_ref()));
                } else {
                    scroll_view_will_hide.setDelegate(None);
                }
            },
        );
    });
}

#[derive(Debug)]
pub struct KeyboardScrollPreventDelegateIvars {
    pub scroll_view: Arc<Retained<UIScrollView>>,
    pub offset: CGPoint,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "KeyboardScrollPreventDelegate"]
    #[ivars = KeyboardScrollPreventDelegateIvars]
    pub struct KeyboardScrollPreventDelegate;

    unsafe impl NSObjectProtocol for KeyboardScrollPreventDelegate {}

    unsafe impl UIScrollViewDelegate for KeyboardScrollPreventDelegate {
        #[unsafe(method(scrollViewDidScroll:))]
        unsafe fn scrollViewDidScroll(&self, _scroll_view: &UIScrollView) {
            self.ivars().scroll_view.setContentOffset(self.ivars().offset);
        }
    }
);

impl KeyboardScrollPreventDelegate {
    fn new(
        mtm: MainThreadMarker,
        scroll_view: Arc<Retained<UIScrollView>>,
        offset: CGPoint,
    ) -> Retained<Self> {
        let this = mtm.alloc::<Self>();
        let this = this.set_ivars(KeyboardScrollPreventDelegateIvars {
            scroll_view,
            offset,
        });
        unsafe { msg_send![super(this), init] }
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
