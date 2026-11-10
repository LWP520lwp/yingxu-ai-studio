package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.flywaydb.core.api.callback.Event;
import org.junit.jupiter.api.Test;

class DatabaseCollationCompatibilityTest {
    @Test void freshIdentityAbsenceAndMatchingDefaultsDoNotExecuteDdl()throws Exception{
        var connection=mock(Connection.class);var statement=mock(Statement.class);var result=mock(ResultSet.class);
        when(connection.createStatement()).thenReturn(statement);when(statement.executeQuery(anyString())).thenReturn(result);
        when(result.next()).thenReturn(false,true);when(result.getString(1)).thenReturn("utf8mb4");when(result.getString(2)).thenReturn("utf8mb4_0900_ai_ci");when(result.getString(3)).thenReturn("utf8mb4_0900_ai_ci");
        DatabaseCollationCompatibility.align(connection);DatabaseCollationCompatibility.align(connection);
        verify(statement,never()).execute(anyString());
    }
    @Test void onlyTheDatabaseDefaultChangesAndSelectedDatabaseNamesAreQuoted()throws Exception{
        var connection=mock(Connection.class);var statement=mock(Statement.class);var result=mock(ResultSet.class);
        when(connection.createStatement()).thenReturn(statement);when(statement.executeQuery(anyString())).thenReturn(result);when(result.next()).thenReturn(true);
        when(result.getString(1)).thenReturn("utf8mb4");when(result.getString(2)).thenReturn("utf8mb4_0900_ai_ci");when(result.getString(3)).thenReturn("utf8mb4_unicode_ci");when(connection.getCatalog()).thenReturn("workbench`test");
        DatabaseCollationCompatibility.align(connection);
        verify(statement).execute("ALTER DATABASE `workbench``test` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    }
    @Test void invalidEncodingMetadataIsRejectedBeforeDdl()throws Exception{
        var connection=mock(Connection.class);var statement=mock(Statement.class);var result=mock(ResultSet.class);
        when(connection.createStatement()).thenReturn(statement);when(statement.executeQuery(anyString())).thenReturn(result);when(result.next()).thenReturn(true);
        when(result.getString(1)).thenReturn("utf8mb4;DROP");when(result.getString(2)).thenReturn("utf8mb4_0900_ai_ci");when(result.getString(3)).thenReturn("utf8mb4_unicode_ci");
        assertThrows(SQLException.class,()->DatabaseCollationCompatibility.align(connection));verify(statement,never()).execute(anyString());
        var callback=new DatabaseCollationCompatibility();assertTrue(callback.supports(Event.BEFORE_EACH_MIGRATE,null));assertFalse(callback.supports(Event.AFTER_MIGRATE,null));
    }
}
