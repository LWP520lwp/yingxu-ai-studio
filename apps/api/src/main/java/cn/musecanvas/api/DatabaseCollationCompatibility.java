package cn.musecanvas.api;

import java.sql.Connection;
import java.sql.SQLException;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.callback.Callback;
import org.flywaydb.core.api.callback.Context;
import org.flywaydb.core.api.callback.Event;
import org.springframework.stereotype.Component;

/** Align legacy migration defaults without rewriting any applied migration or existing table. */
@Component
public class DatabaseCollationCompatibility implements Callback {
    @Override public boolean supports(Event event,Context context){return event==Event.BEFORE_EACH_MIGRATE;}
    @Override public boolean canHandleInTransaction(Event event,Context context){return false;}
    @Override public String getCallbackName(){return "align-database-collation";}
    @Override public void handle(Event event,Context context){
        try { align(context.getConnection()); }
        catch(SQLException ex){throw new FlywayException("Cannot align migration defaults with app_user.id; check database ALTER privileges",ex);}
    }
    static void align(Connection connection)throws SQLException {
        String charset,collation,current;
        try(var statement=connection.createStatement();var result=statement.executeQuery("SELECT c.CHARACTER_SET_NAME,c.COLLATION_NAME,s.DEFAULT_COLLATION_NAME FROM information_schema.COLUMNS c JOIN information_schema.SCHEMATA s ON s.SCHEMA_NAME=c.TABLE_SCHEMA WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='app_user' AND c.COLUMN_NAME='id'")){
            if(!result.next())return; // V1 has not created the identity table yet.
            charset=result.getString(1);collation=result.getString(2);current=result.getString(3);
        }
        if(collation==null||collation.equals(current))return;
        if(charset==null||!charset.matches("[A-Za-z0-9_]+")||!collation.matches("[A-Za-z0-9_]+"))throw new SQLException("Unexpected identity column encoding metadata");
        String database=connection.getCatalog();if(database==null||database.isBlank())throw new SQLException("No selected database");
        // MySQL does not support ALTER DATABASE in prepared statements. All encoding
        // names come from validated server metadata; quote the selected identifier.
        try(var statement=connection.createStatement()){
            statement.execute("ALTER DATABASE `"+database.replace("`","``")+"` DEFAULT CHARACTER SET "+charset+" COLLATE "+collation);
        }
    }
}
