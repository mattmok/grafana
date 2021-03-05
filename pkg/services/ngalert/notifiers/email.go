package notifiers

import (
	"context"
	"github.com/prometheus/alertmanager/notify"
	"github.com/prometheus/alertmanager/template"
	"github.com/prometheus/common/model"
	"io/ioutil"
	"net/url"

	gokit_log "github.com/go-kit/kit/log"
	"github.com/grafana/grafana/pkg/infra/log"
	"github.com/grafana/grafana/pkg/models"
	"github.com/grafana/grafana/pkg/services/alerting"
	old_notifiers "github.com/grafana/grafana/pkg/services/alerting/notifiers"
	"github.com/grafana/grafana/pkg/services/notifications"
	"github.com/grafana/grafana/pkg/util"

	"github.com/prometheus/alertmanager/types"
)

//func init() {
//	alerting.RegisterNotifier(&alerting.NotifierPlugin{
//		Type:        "email",
//		Name:        "Email",
//		Description: "Sends notifications using Grafana server configured SMTP settings",
//		Factory:     NewEmailNotifier,
//		Heading:     "Email settings",
//		Options: []alerting.NotifierOption{
//			{
//				Label:        "Single email",
//				Description:  "Send a single email to all recipients",
//				Element:      alerting.ElementTypeCheckbox,
//				PropertyName: "singleEmail",
//			},
//			{
//				Label:        "Addresses",
//				Description:  "You can enter multiple email addresses using a \";\" separator",
//				Element:      alerting.ElementTypeTextArea,
//				PropertyName: "addresses",
//				Required:     true,
//			},
//		},
//	})
//}

// EmailNotifier is responsible for sending
// alert notifications over email.
type EmailNotifier struct {
	old_notifiers.NotifierBase
	Addresses      []string
	SingleEmail    bool
	log            log.Logger
	templateString string
	template       *template.Template
}

// NewEmailNotifier is the constructor function
// for the EmailNotifier.
func NewEmailNotifier(model *models.AlertNotification) (*EmailNotifier, error) {
	addressesString := model.Settings.Get("addresses").MustString()
	singleEmail := model.Settings.Get("singleEmail").MustBool(false)

	if addressesString == "" {
		return nil, alerting.ValidationError{Reason: "Could not find addresses in settings"}
	}

	// split addresses with a few different ways
	addresses := util.SplitEmails(addressesString)

	// TODO(codesome): understand how this works with everything else.
	tmpl, err := template.FromGlobs("templates/email.html")
	if err != nil {
		return nil, err
	}
	// TODO: remove this URL hack and add an actual external URL.
	u, err := url.Parse("http://localhost")
	if err != nil {
		return nil, err
	}
	tmpl.ExternalURL = u

	templateBytes, err := ioutil.ReadFile("templates/email.html")
	if err != nil {
		return nil, err
	}

	return &EmailNotifier{
		NotifierBase:   old_notifiers.NewNotifierBase(model),
		Addresses:      addresses,
		SingleEmail:    singleEmail,
		log:            log.New("alerting.notifier.email"),
		templateString: string(templateBytes),
		template:       tmpl,
	}, nil
}

// Notify sends the alert notification.
func (en *EmailNotifier) Notify(ctx context.Context, as ...*types.Alert) error {
	// TODO(codesome): make sure the receiver name is added in the ctx before calling this.
	ctx = notify.WithReceiverName(ctx, "email-notification-channel") // Dummy.
	// TODO(codesome): make sure the group labels is added in the ctx before calling this.
	ctx = notify.WithGroupLabels(ctx, model.LabelSet{}) // Dummy.

	msg := &notifications.Message{
		To:          en.Addresses,
		SingleEmail: en.SingleEmail,
		From:        "",  // TODO(codesome): set this.
		Subject:     "",  // TODO(codesome): set this.
		Info:        "",  // TODO(codesome): what is this?
		ReplyTo:     nil, // TODO(codesome): set this.
	}

	// We only need ExternalURL from this template object.
	data := notify.GetTemplateData(ctx, en.template, as, gokit_log.NewNopLogger())
	body, err := en.template.ExecuteHTMLString(en.templateString, data)
	if err != nil {
		return err
	}
	msg.Body = body

	// TODO(codesome): use the initiated NotificationService, this is just a dummy.
	ns := notifications.NotificationService{}
	_, err = ns.Send(msg)

	return err
}
